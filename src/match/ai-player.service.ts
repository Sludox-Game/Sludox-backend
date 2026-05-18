import { Injectable, Logger } from '@nestjs/common';
import { Player, Token, DiceRoll } from '../common/interfaces';
import { TokenState, SeatType } from '../common/enums';
import { LudoEngine } from './ludo-engine.service';

@Injectable()
export class AiPlayerService {
  private readonly logger = new Logger(AiPlayerService.name);

  constructor(private readonly ludoEngine: LudoEngine) {}

  /**
   * Convert a player seat to AI control.
   */
  convertToAI(player: Player): Player {
    player.seatType = SeatType.AI;
    this.logger.log(`Player ${player.color} converted to AI`);
    return player;
  }

  /**
   * Make an AI move decision.
   * Returns the token ID to move, or -1 if no valid move.
   */
  decideMove(player: Player, diceRoll: DiceRoll): number {
    const movableTokens = player.tokens.filter((t) =>
      this.ludoEngine.canMove(t, diceRoll.value),
    );

    if (movableTokens.length === 0) return -1;

    // Simple AI strategy:
    // 1. Prefer to move tokens that are closest to finishing
    // 2. If a 6 is rolled and there are tokens at home, bring one out
    // 3. Otherwise move the token that's furthest along

    if (diceRoll.value === 6) {
      const homeTokens = movableTokens.filter(
        (t) => t.state === TokenState.HOME,
      );
      if (homeTokens.length > 0) {
        return homeTokens[0].id;
      }
    }

    // Move the token that's furthest along the board
    movableTokens.sort((a, b) => b.position - a.position);
    return movableTokens[0].id;
  }

  /**
   * Execute an AI turn: roll dice and decide move.
   */
  executeTurn(player: Player): { diceRoll: DiceRoll; tokenId: number } {
    const diceRoll = this.ludoEngine.rollDice();
    const tokenId = this.decideMove(player, diceRoll);

    this.logger.log(
      `AI (${player.color}) rolled ${diceRoll.value}, moving token ${tokenId}`,
    );

    return { diceRoll, tokenId };
  }
}
