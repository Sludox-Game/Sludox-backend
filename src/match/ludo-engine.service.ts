import { Injectable, Logger } from '@nestjs/common';
import {
  PlayerColor,
  TokenState,
  MatchStatus,
  SeatType,
} from '../common/enums';
import {
  Match,
  Player,
  Token,
  DiceRoll,
} from '../common/interfaces';
import {
  PLAYERS_PER_MATCH,
  TOKENS_PER_PLAYER,
  BOARD_SIZE,
  SAFE_SQUARES,
  GOAL_POSITION,
} from '../common/constants';

export interface MoveValidationResult {
  valid: boolean;
  reason?: string;
  newPosition?: number;
  newStepCount?: number;
  captured?: {
    player: Player;
    token: Token;
  };
  isFinished?: boolean;
}

@Injectable()
export class LudoEngine {
  private readonly logger = new Logger(LudoEngine.name);

  /**
   * Create a new match with initial state.
   */
  createMatch(id: string, players: Player[]): Match {
    return {
      id,
      status: MatchStatus.WAITING,
      players,
      currentTurnIndex: 0,
      turnOrder: players.map((p) => p.color),
      turnDeadline: null,
      startedAt: null,
      finishedAt: null,
      winner: null,
      currentDiceRoll: null,
      hasRolled: false,
    };
  }

  /**
   * Initialize tokens for a player (all in HOME state).
   */
  createTokens(): Token[] {
    return Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => ({
      id: i,
      state: TokenState.HOME,
      position: -1,
      stepCount: 0,
    }));
  }

  /**
   * Roll a dice (1-6).
   */
  rollDice(): DiceRoll {
    const value = Math.floor(Math.random() * 6) + 1;
    return { value, isDouble: false };
  }

  /**
   * Get the starting board position for a given color.
   */
  getStartPosition(color: PlayerColor): number {
    const positions: Record<PlayerColor, number> = {
      [PlayerColor.RED]: 0,
      [PlayerColor.BLUE]: 13,
      [PlayerColor.GREEN]: 26,
      [PlayerColor.YELLOW]: 39,
    };
    return positions[color];
  }

  /**
   * Calculate steps traveled (1 to 57) for a token.
   */
  getStepCount(token: Token, color: PlayerColor): number {
    if (token.state === TokenState.HOME || token.position === -1) {
      return 0;
    }
    if (token.stepCount !== undefined && token.stepCount > 0) {
      return token.stepCount;
    }
    if (token.position >= 52) {
      return token.position;
    }
    const start = this.getStartPosition(color);
    return ((token.position - start + BOARD_SIZE) % BOARD_SIZE) + 1;
  }

  /**
   * Determine if a square index is a safe square.
   */
  isSafeSquare(position: number): boolean {
    return SAFE_SQUARES.includes(position);
  }

  /**
   * Determine if a token can move based on dice roll.
   */
  canMove(token: Token, diceValue: number, color?: PlayerColor): boolean {
    if (token.state === TokenState.FINISHED) return false;
    if (token.state === TokenState.HOME || token.position === -1) {
      return diceValue === 6;
    }

    const currentStep = color
      ? this.getStepCount(token, color)
      : token.stepCount ?? (token.position >= 52 ? token.position : 1);

    // Rule: Exact landing required to reach GOAL (step 57)
    return currentStep + diceValue <= GOAL_POSITION;
  }

  /**
   * Check if player has any legal moves available with given dice roll.
   */
  hasAnyValidMove(player: Player, diceValue: number): boolean {
    return player.tokens.some((token) =>
      this.canMove(token, diceValue, player.color),
    );
  }

  /**
   * Calculate the new position and stepCount for a token.
   */
  calculateNewPosition(
    token: Token,
    diceValue: number,
    color: PlayerColor,
  ): { newPosition: number; newStepCount: number; isFinished: boolean } {
    if (token.state === TokenState.HOME || token.position === -1) {
      return {
        newPosition: this.getStartPosition(color),
        newStepCount: 1,
        isFinished: false,
      };
    }

    const currentStep = this.getStepCount(token, color);
    const newStepCount = currentStep + diceValue;

    if (newStepCount > GOAL_POSITION) {
      throw new Error(
        `Move overshoots goal: step ${newStepCount} > ${GOAL_POSITION}`,
      );
    }

    if (newStepCount === GOAL_POSITION) {
      return {
        newPosition: GOAL_POSITION,
        newStepCount: GOAL_POSITION,
        isFinished: true,
      };
    }

    if (newStepCount > 51) {
      // Inside home column (52..56)
      return {
        newPosition: newStepCount,
        newStepCount,
        isFinished: false,
      };
    }

    // Still on standard main track
    const startPos = this.getStartPosition(color);
    const newPosition = (startPos + newStepCount - 1) % BOARD_SIZE;

    return {
      newPosition,
      newStepCount,
      isFinished: false,
    };
  }

  /**
   * Server-authoritative move validation.
   * Prevents client-side tampering, enforces dice value, home rules, safe squares.
   */
  validateMove(
    match: Match,
    playerColor: PlayerColor,
    tokenId: number,
    diceValue: number,
  ): MoveValidationResult {
    const player = match.players.find((p) => p.color === playerColor);
    if (!player) {
      return { valid: false, reason: `Player ${playerColor} not found in match` };
    }

    const token = player.tokens.find((t) => t.id === tokenId);
    if (!token) {
      return { valid: false, reason: `Token ${tokenId} not found` };
    }

    if (token.state === TokenState.FINISHED) {
      return { valid: false, reason: 'Token is already finished' };
    }

    if (
      (token.state === TokenState.HOME || token.position === -1) &&
      diceValue !== 6
    ) {
      return {
        valid: false,
        reason: 'Token in home requires a 6 to enter board',
      };
    }

    const currentStep = this.getStepCount(token, playerColor);
    if (token.position !== -1 && currentStep + diceValue > GOAL_POSITION) {
      return {
        valid: false,
        reason: `Move overshoots goal (${currentStep + diceValue} > ${GOAL_POSITION})`,
      };
    }

    const { newPosition, newStepCount, isFinished } = this.calculateNewPosition(
      token,
      diceValue,
      playerColor,
    );

    // Collision & safe squares check
    let captured: { player: Player; token: Token } | undefined;

    if (
      !isFinished &&
      newPosition < BOARD_SIZE &&
      !this.isSafeSquare(newPosition)
    ) {
      for (const opponent of match.players) {
        if (opponent.color === playerColor) continue;

        for (const oppToken of opponent.tokens) {
          if (
            oppToken.state === TokenState.ACTIVE &&
            oppToken.position === newPosition
          ) {
            captured = { player: opponent, token: oppToken };
            break;
          }
        }
        if (captured) break;
      }
    }

    return {
      valid: true,
      newPosition,
      newStepCount,
      captured,
      isFinished,
    };
  }

  /**
   * Apply a validated move to the match state.
   */
  applyMove(
    match: Match,
    playerColor: PlayerColor,
    tokenId: number,
    diceValue: number,
  ): {
    match: Match;
    captured?: { player: Player; token: Token };
    isWinner: boolean;
  } {
    const validation = this.validateMove(
      match,
      playerColor,
      tokenId,
      diceValue,
    );
    if (!validation.valid) {
      throw new Error(`Invalid move: ${validation.reason}`);
    }

    const player = match.players.find((p) => p.color === playerColor)!;
    const token = player.tokens.find((t) => t.id === tokenId)!;

    // Update moving token
    token.position = validation.newPosition!;
    token.stepCount = validation.newStepCount!;
    token.state = validation.isFinished
      ? TokenState.FINISHED
      : TokenState.ACTIVE;

    // Reset captured token to home
    if (validation.captured) {
      validation.captured.token.state = TokenState.HOME;
      validation.captured.token.position = -1;
      validation.captured.token.stepCount = 0;
      this.logger.log(
        `Piece captured! ${playerColor} captured ${validation.captured.player.color} piece at pos ${validation.newPosition}`,
      );
    }

    const isWinner = this.checkWinner(player);
    if (isWinner) {
      match.status = MatchStatus.FINISHED;
      match.finishedAt = Date.now();
      match.winner = playerColor;
      this.logger.log(`Match ${match.id} won by ${playerColor}`);
    }

    return {
      match,
      captured: validation.captured,
      isWinner,
    };
  }

  /**
   * Check if a capture occurred (landing on an opponent's token).
   */
  checkCapture(
    targetPosition: number,
    movingColor: PlayerColor,
    players: Player[],
  ): Player | null {
    if (targetPosition >= BOARD_SIZE || this.isSafeSquare(targetPosition)) {
      return null;
    }

    for (const player of players) {
      if (player.color === movingColor) continue;
      for (const token of player.tokens) {
        if (
          token.state === TokenState.ACTIVE &&
          token.position === targetPosition
        ) {
          return player;
        }
      }
    }
    return null;
  }

  /**
   * Check if a player has won (all tokens finished).
   */
  checkWinner(player: Player): boolean {
    return player.tokens.every((t) => t.state === TokenState.FINISHED);
  }

  /**
   * Get the next player index in turn order.
   */
  getNextTurn(currentIndex: number): number {
    return (currentIndex + 1) % PLAYERS_PER_MATCH;
  }

  /**
   * Determine the winner of the match.
   */
  determineWinner(match: Match): PlayerColor | null {
    for (const player of match.players) {
      if (this.checkWinner(player)) {
        return player.color;
      }
    }
    return null;
  }
}
