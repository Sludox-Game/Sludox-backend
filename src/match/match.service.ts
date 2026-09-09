import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Match, Player, DiceRoll } from '../common/interfaces';
import { MatchStatus, SeatType, TokenState, PlayerColor } from '../common/enums';
import {
  QUEUES,
  TURN_TIMEOUT_SECONDS,
  MAX_TIMEOUT_STRIKES,
  CAPTURE_REWARD_XLM,
  BASE_BUY_IN_XLM,
  PLAYERS_PER_MATCH,
  PLATFORM_RAKE_PERCENT,
} from '../common/constants';
import { LudoEngine } from './ludo-engine.service';
import { AiPlayerService } from './ai-player.service';
import { MatchmakingService } from './matchmaking.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { VoiceService } from '../voice/voice.service';

@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);

  constructor(
    private readonly ludoEngine: LudoEngine,
    private readonly aiPlayerService: AiPlayerService,
    private readonly matchmakingService: MatchmakingService,
    @InjectQueue(QUEUES.TRANSACTION)
    private readonly transactionQueue: Queue,
    @Optional()
    private readonly leaderboardService?: LeaderboardService,
    @Optional()
    private readonly voiceService?: VoiceService,
  ) {}

  /**
   * Start a match (set status, timers, etc.).
   */
  startMatch(matchId: string): Match | undefined {
    const match = this.matchmakingService.getMatch(matchId);
    if (!match) return undefined;

    match.status = MatchStatus.STARTED;
    match.startedAt = Date.now();
    match.currentTurnIndex = 0;
    match.turnDeadline = Date.now() + TURN_TIMEOUT_SECONDS * 1000;
    match.hasRolled = false;
    match.currentDiceRoll = null;

    this.matchmakingService.updateMatch(matchId, match);
    this.logger.log(`Match ${matchId} started`);
    return match;
  }

  /**
   * Handle a dice roll from a player.
   */
  handleRollDice(
    matchId: string,
    playerColor: string,
  ): { match: Match; diceRoll: DiceRoll; autoTurnAdvanced: boolean } | null {
    const match = this.matchmakingService.getMatch(matchId);
    if (!match || match.status !== MatchStatus.STARTED) return null;

    const currentPlayer = match.players[match.currentTurnIndex];
    if (currentPlayer.color !== playerColor) {
      this.logger.warn(
        `Roll rejected: current turn is ${currentPlayer.color}, received ${playerColor}`,
      );
      return null;
    }

    if (match.hasRolled) {
      this.logger.warn(`Roll rejected: player ${playerColor} already rolled this turn`);
      return null;
    }

    const diceRoll = this.ludoEngine.rollDice();
    match.currentDiceRoll = diceRoll;
    match.hasRolled = true;

    // Check if player has any legal moves available with this dice roll
    const hasLegalMove = this.ludoEngine.hasAnyValidMove(currentPlayer, diceRoll.value);
    let autoTurnAdvanced = false;

    if (!hasLegalMove) {
      this.logger.log(
        `Player ${playerColor} rolled ${diceRoll.value} with no valid moves. Advancing turn automatically.`,
      );
      match.hasRolled = false;
      match.currentDiceRoll = null;
      match.currentTurnIndex = this.ludoEngine.getNextTurn(match.currentTurnIndex);
      match.turnDeadline = Date.now() + TURN_TIMEOUT_SECONDS * 1000;
      autoTurnAdvanced = true;
    }

    this.matchmakingService.updateMatch(matchId, match);
    return { match, diceRoll, autoTurnAdvanced };
  }

  /**
   * Handle a token move from a player with server-authoritative validation.
   */
  async handleMoveToken(
    matchId: string,
    playerColor: string,
    tokenId: number,
  ): Promise<{
    match: Match;
    captured?: Player;
    isWinner?: boolean;
  } | null> {
    const match = this.matchmakingService.getMatch(matchId);
    if (!match || match.status !== MatchStatus.STARTED) return null;

    const currentPlayer = match.players[match.currentTurnIndex];
    if (currentPlayer.color !== playerColor) {
      this.logger.warn(`Move rejected: not ${playerColor}'s turn`);
      return null;
    }

    if (!match.hasRolled || !match.currentDiceRoll) {
      this.logger.warn(`Move rejected: player must roll before moving`);
      return null;
    }

    const diceValue = match.currentDiceRoll.value;
    const validation = this.ludoEngine.validateMove(
      match,
      playerColor as PlayerColor,
      tokenId,
      diceValue,
    );

    if (!validation.valid) {
      this.logger.warn(`Move rejected: ${validation.reason}`);
      return null;
    }

    // Apply move deterministically
    const moveResult = this.ludoEngine.applyMove(
      match,
      playerColor as PlayerColor,
      tokenId,
      diceValue,
    );

    // Reset turn dice state
    match.hasRolled = false;
    match.currentDiceRoll = null;

    // Handle capture
    let capturedPlayer: Player | undefined;
    if (moveResult.captured) {
      capturedPlayer = moveResult.captured.player;

      // Queue capture payout transaction in BullMQ
      await this.transactionQueue.add('capture-payout', {
        type: 'capture_payout',
        matchId,
        fromWallet: capturedPlayer.walletAddress,
        toWallet: currentPlayer.walletAddress,
        amount: CAPTURE_REWARD_XLM.toString(),
      });

      // Record in Leaderboard service
      if (this.leaderboardService) {
        await this.leaderboardService.recordCapture(
          currentPlayer.walletAddress,
          CAPTURE_REWARD_XLM,
        );
      }

      this.logger.log(
        `Capture! ${currentPlayer.color} captured ${capturedPlayer.color}'s token`,
      );
    }

    // Handle winner
    if (moveResult.isWinner) {
      match.status = MatchStatus.FINISHED;
      match.finishedAt = Date.now();
      match.winner = playerColor as PlayerColor;

      const totalBuyIns = BASE_BUY_IN_XLM * PLAYERS_PER_MATCH;
      const rake = totalBuyIns * (PLATFORM_RAKE_PERCENT / 100);
      const winnerPrize = totalBuyIns - rake;

      // Queue winner payout
      await this.transactionQueue.add('winner-payout', {
        type: 'winner_payout',
        matchId,
        toWallet: currentPlayer.walletAddress,
        amount: winnerPrize.toFixed(4),
      });

      // Record in Leaderboard service
      if (this.leaderboardService) {
        await this.leaderboardService.recordWin(
          currentPlayer.walletAddress,
          winnerPrize,
        );
      }

      // Cleanup voice room
      if (this.voiceService) {
        this.voiceService.cleanupMatchRoom(matchId);
      }
    } else {
      // Advance turn to next player
      match.currentTurnIndex = this.ludoEngine.getNextTurn(match.currentTurnIndex);
      match.turnDeadline = Date.now() + TURN_TIMEOUT_SECONDS * 1000;
    }

    this.matchmakingService.updateMatch(matchId, match);
    return {
      match,
      captured: capturedPlayer,
      isWinner: moveResult.isWinner,
    };
  }

  /**
   * Handle a player timeout.
   */
  handleTimeout(matchId: string, playerColor: string): Match | null {
    const match = this.matchmakingService.getMatch(matchId);
    if (!match) return null;

    const player = match.players.find((p) => p.color === playerColor);
    if (!player) return null;

    player.timeoutStrikes++;

    if (player.timeoutStrikes >= MAX_TIMEOUT_STRIKES) {
      this.aiPlayerService.convertToAI(player);
      this.logger.log(`AI takeover for ${playerColor} in match ${matchId}`);
    }

    // Reset turn dice state and rotate turn
    match.hasRolled = false;
    match.currentDiceRoll = null;
    match.currentTurnIndex = this.ludoEngine.getNextTurn(match.currentTurnIndex);
    match.turnDeadline = Date.now() + TURN_TIMEOUT_SECONDS * 1000;

    this.matchmakingService.updateMatch(matchId, match);
    return match;
  }

  /**
   * Handle player disconnect.
   */
  handleDisconnect(matchId: string, playerColor: string): Match | null {
    const match = this.matchmakingService.getMatch(matchId);
    if (!match) return null;

    const player = match.players.find((p) => p.color === playerColor);
    if (!player) return null;

    player.isConnected = false;

    // Convert to AI immediately on disconnect
    this.aiPlayerService.convertToAI(player);
    this.logger.log(
      `Player ${playerColor} disconnected in match ${matchId}, AI takeover`,
    );

    this.matchmakingService.updateMatch(matchId, match);
    return match;
  }

  /**
   * End a match and clean up voice and session resources.
   */
  async endMatch(matchId: string): Promise<void> {
    const match = this.matchmakingService.getMatch(matchId);
    if (!match) return;

    match.status = MatchStatus.FINISHED;
    match.finishedAt = Date.now();
    this.matchmakingService.updateMatch(matchId, match);

    if (this.voiceService) {
      this.voiceService.cleanupMatchRoom(matchId);
    }

    this.logger.log(`Match ${matchId} ended and cleaned up`);
  }
}

