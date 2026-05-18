import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Match, Player, DiceRoll } from '../common/interfaces';
import { MatchStatus, SeatType, TokenState } from '../common/enums';
import {
  QUEUES,
  TURN_TIMEOUT_SECONDS,
  MAX_TIMEOUT_STRIKES,
  CAPTURE_REWARD_XLM,
} from '../common/constants';
import { LudoEngine } from './ludo-engine.service';
import { AiPlayerService } from './ai-player.service';
import { MatchmakingService } from './matchmaking.service';

/**
 * On-chain integration notes:
 *
 * 1. Dice rolls should use the Soroban contract's commit-reveal:
 *    - Call `commit_dice_roll(match_id, player, hash(nonce, value))` on the contract
 *    - Call `reveal_dice_roll(match_id, player, nonce, value)` to get the verified result
 *
 * 2. Moves should be validated via the contract before execution:
 *    - Call `validate_move(match_id, player, token_id, dice_value, from_pos, to_pos)`
 *    - The contract enforces: HOME tokens need 6, board moves match dice, no finish overshoot
 *
 * 3. AI failover is handled on-chain:
 *    - Call `report_inactivity(match_id, reporter, inactive_player)` to prove timeout
 *    - After 2 timeout strikes, `is_ai_controlled(match_id, player)` returns true
 *    - Call `execute_ai_move(match_id, ai_player, move_action)` for contract-enforced AI moves
 *
 * 4. Game state is tracked on-chain:
 *    - Call `initialize_game_state(match_id, players, turn_timeout)` after match init
 *    - Call `advance_turn(match_id)` to rotate to next player
 *    - Call `get_game_state(match_id)` to query turn index, deadlines, AI status
 */

@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);

  constructor(
    private readonly ludoEngine: LudoEngine,
    private readonly aiPlayerService: AiPlayerService,
    private readonly matchmakingService: MatchmakingService,
    @InjectQueue(QUEUES.TRANSACTION)
    private readonly transactionQueue: Queue,
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
  ): { match: Match; diceRoll: DiceRoll } | null {
    const match = this.matchmakingService.getMatch(matchId);
    if (!match || match.status !== MatchStatus.STARTED) return null;

    const currentPlayer = match.players[match.currentTurnIndex];
    if (currentPlayer.color !== playerColor) return null;

    const diceRoll = this.ludoEngine.rollDice();
    return { match, diceRoll };
  }

  /**
   * Handle a token move from a player.
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

    const player = match.players.find((p) => p.color === playerColor);
    if (!player) return null;

    const token = player.tokens.find((t) => t.id === tokenId);
    if (!token) return null;

    // Calculate new position
    const newPosition = this.ludoEngine.calculateNewPosition(
      token,
      1, // TODO: Use actual dice value from state
      player.color,
    );

    // Update token position
    token.position = newPosition;
    token.state = TokenState.ACTIVE;

    // Check for capture
    const capturedPlayer = this.ludoEngine.checkCapture(
      newPosition,
      player.color,
      match.players,
    );

    if (capturedPlayer) {
      // Send captured token back home
      for (const t of capturedPlayer.tokens) {
        if (t.position === newPosition) {
          t.state = TokenState.HOME;
          t.position = -1;
        }
      }

      // Queue capture payout transaction
      await this.transactionQueue.add('capture-payout', {
        type: 'capture_payout',
        matchId,
        fromWallet: capturedPlayer.walletAddress,
        toWallet: player.walletAddress,
        amount: CAPTURE_REWARD_XLM.toString(),
      });

      this.logger.log(
        `Capture! ${player.color} captured ${capturedPlayer.color}'s token`,
      );
    }

    // Check for winner
    const isWinner = this.ludoEngine.checkWinner(player);
    if (isWinner) {
      match.status = MatchStatus.FINISHED;
      match.finishedAt = Date.now();
      match.winner = player.color;

      // Queue winner payout
      await this.transactionQueue.add('winner-payout', {
        type: 'winner_payout',
        matchId,
        toWallet: player.walletAddress,
        amount: '0', // TODO: Calculate remaining pot
      });
    }

    // Advance turn
    match.currentTurnIndex = this.ludoEngine.getNextTurn(
      match.currentTurnIndex,
    );
    match.turnDeadline = Date.now() + TURN_TIMEOUT_SECONDS * 1000;

    this.matchmakingService.updateMatch(matchId, match);

    return { match, captured: capturedPlayer || undefined, isWinner };
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
      // Convert to AI
      this.aiPlayerService.convertToAI(player);
      this.logger.log(`AI takeover for ${playerColor} in match ${matchId}`);
    }

    // Advance turn
    match.currentTurnIndex = this.ludoEngine.getNextTurn(
      match.currentTurnIndex,
    );
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
   * End a match and clean up.
   */
  async endMatch(matchId: string): Promise<void> {
    const match = this.matchmakingService.getMatch(matchId);
    if (!match) return;

    match.status = MatchStatus.FINISHED;
    match.finishedAt = Date.now();
    this.matchmakingService.updateMatch(matchId, match);

    this.logger.log(`Match ${matchId} ended`);
  }
}
