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
} from '../common/constants';

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
   * Determine if a token can move based on dice roll.
   */
  canMove(token: Token, diceValue: number): boolean {
    if (token.state === TokenState.FINISHED) return false;
    if (token.state === TokenState.HOME) return diceValue === 6;
    return true;
  }

  /**
   * Calculate the new position for a token.
   */
  calculateNewPosition(
    token: Token,
    diceValue: number,
    color: PlayerColor,
  ): number {
    if (token.state === TokenState.HOME) {
      // Token enters the board at the starting position for this color
      return this.getStartPosition(color);
    }
    return (token.position + diceValue) % BOARD_SIZE;
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
   * Check if a capture occurred (landing on an opponent's token).
   */
  checkCapture(
    targetPosition: number,
    movingColor: PlayerColor,
    players: Player[],
  ): Player | null {
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
