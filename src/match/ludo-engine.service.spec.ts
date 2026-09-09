import { Test, TestingModule } from '@nestjs/testing';
import { LudoEngine } from './ludo-engine.service';
import { PlayerColor, TokenState, MatchStatus, SeatType } from '../common/enums';
import { Match, Player } from '../common/interfaces';
import { SAFE_SQUARES, GOAL_POSITION, BOARD_SIZE } from '../common/constants';

describe('LudoEngine (SG-B01 & SG-B03)', () => {
  let engine: LudoEngine;

  const createMockPlayer = (
    color: PlayerColor,
    tokenConfigs: Array<{ id: number; pos: number; state: TokenState; stepCount?: number }>,
  ): Player => ({
    userId: `user_${color}`,
    walletAddress: `G${color.toUpperCase()}1234567890`,
    color,
    seatType: SeatType.HUMAN,
    tokens: tokenConfigs.map((cfg) => ({
      id: cfg.id,
      position: cfg.pos,
      state: cfg.state,
      stepCount: cfg.stepCount ?? (cfg.pos === -1 ? 0 : 1),
    })),
    timeoutStrikes: 0,
    isConnected: true,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LudoEngine],
    }).compile();

    engine = module.get<LudoEngine>(LudoEngine);
  });

  describe('Board Initialization & Token Creation', () => {
    it('should initialize match with 4 players and initial waiting status', () => {
      const players = [
        createMockPlayer(PlayerColor.RED, [{ id: 0, pos: -1, state: TokenState.HOME }]),
        createMockPlayer(PlayerColor.BLUE, [{ id: 0, pos: -1, state: TokenState.HOME }]),
      ];
      const match = engine.createMatch('match-1', players);
      expect(match.id).toBe('match-1');
      expect(match.status).toBe(MatchStatus.WAITING);
      expect(match.currentTurnIndex).toBe(0);
      expect(match.winner).toBeNull();
    });

    it('should initialize 4 tokens in HOME state at position -1', () => {
      const tokens = engine.createTokens();
      expect(tokens).toHaveLength(4);
      tokens.forEach((token, idx) => {
        expect(token.id).toBe(idx);
        expect(token.state).toBe(TokenState.HOME);
        expect(token.position).toBe(-1);
        expect(token.stepCount).toBe(0);
      });
    });

    it('should return correct starting positions for each color', () => {
      expect(engine.getStartPosition(PlayerColor.RED)).toBe(0);
      expect(engine.getStartPosition(PlayerColor.BLUE)).toBe(13);
      expect(engine.getStartPosition(PlayerColor.GREEN)).toBe(26);
      expect(engine.getStartPosition(PlayerColor.YELLOW)).toBe(39);
    });
  });

  describe('Dice Rolls & Move Permissions (canMove & hasAnyValidMove)', () => {
    it('should generate dice roll between 1 and 6', () => {
      for (let i = 0; i < 50; i++) {
        const roll = engine.rollDice();
        expect(roll.value).toBeGreaterThanOrEqual(1);
        expect(roll.value).toBeLessThanOrEqual(6);
      }
    });

    it('should not allow HOME tokens to move if dice is not 6', () => {
      const token = { id: 0, state: TokenState.HOME, position: -1, stepCount: 0 };
      expect(engine.canMove(token, 1, PlayerColor.RED)).toBe(false);
      expect(engine.canMove(token, 5, PlayerColor.RED)).toBe(false);
      expect(engine.canMove(token, 6, PlayerColor.RED)).toBe(true);
    });

    it('should not allow FINISHED tokens to move', () => {
      const token = { id: 0, state: TokenState.FINISHED, position: 57, stepCount: 57 };
      expect(engine.canMove(token, 1)).toBe(false);
      expect(engine.canMove(token, 6)).toBe(false);
    });

    it('should allow active tokens to move within board and home stretch', () => {
      const token = { id: 0, state: TokenState.ACTIVE, position: 0, stepCount: 1 };
      expect(engine.canMove(token, 3, PlayerColor.RED)).toBe(true);
    });

    it('should detect if player has any valid moves', () => {
      const player = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: -1, state: TokenState.HOME, stepCount: 0 },
        { id: 1, pos: -1, state: TokenState.HOME, stepCount: 0 },
      ]);
      expect(engine.hasAnyValidMove(player, 3)).toBe(false);
      expect(engine.hasAnyValidMove(player, 6)).toBe(true);
    });
  });

  describe('Home Exit and Track Navigation', () => {
    it('should move HOME token to starting square on roll of 6', () => {
      const token = { id: 0, state: TokenState.HOME, position: -1, stepCount: 0 };
      const res = engine.calculateNewPosition(token, 6, PlayerColor.RED);
      expect(res.newPosition).toBe(0);
      expect(res.newStepCount).toBe(1);
      expect(res.isFinished).toBe(false);

      const blueRes = engine.calculateNewPosition(token, 6, PlayerColor.BLUE);
      expect(blueRes.newPosition).toBe(13);
      expect(blueRes.newStepCount).toBe(1);
    });

    it('should advance token along main board clockwise and wrap around 52', () => {
      const blueToken = { id: 0, state: TokenState.ACTIVE, position: 50, stepCount: 38 };
      const res = engine.calculateNewPosition(blueToken, 4, PlayerColor.BLUE);
      // blue starts at 13, new stepCount = 42, board pos = (13 + 42 - 1) % 52 = 2
      expect(res.newStepCount).toBe(42);
      expect(res.newPosition).toBe(2);
      expect(res.isFinished).toBe(false);
    });
  });

  describe('Safe Squares and Board Collisions (SG-B01 & SG-B03)', () => {
    it('should recognize all 8 safe squares', () => {
      [0, 8, 13, 21, 26, 34, 39, 47].forEach((pos) => {
        expect(engine.isSafeSquare(pos)).toBe(true);
      });
      expect(engine.isSafeSquare(1)).toBe(false);
      expect(engine.isSafeSquare(12)).toBe(false);
      expect(engine.isSafeSquare(50)).toBe(false);
    });

    it('should capture opponent piece on non-safe square and reset it to HOME', () => {
      const redPlayer = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 5, state: TokenState.ACTIVE, stepCount: 6 },
      ]);
      const bluePlayer = createMockPlayer(PlayerColor.BLUE, [
        { id: 0, pos: 9, state: TokenState.ACTIVE, stepCount: 49 },
      ]);
      const match = engine.createMatch('match-capture', [redPlayer, bluePlayer]);

      // Red rolls 4, landing on pos 9 (which is NOT a safe square)
      const val = engine.validateMove(match, PlayerColor.RED, 0, 4);
      expect(val.valid).toBe(true);
      expect(val.newPosition).toBe(9);
      expect(val.captured).toBeDefined();
      expect(val.captured?.player.color).toBe(PlayerColor.BLUE);
      expect(val.captured?.token.id).toBe(0);

      // Applying the move
      const applied = engine.applyMove(match, PlayerColor.RED, 0, 4);
      expect(applied.captured).toBeDefined();
      expect(redPlayer.tokens[0].position).toBe(9);
      expect(bluePlayer.tokens[0].position).toBe(-1);
      expect(bluePlayer.tokens[0].state).toBe(TokenState.HOME);
      expect(bluePlayer.tokens[0].stepCount).toBe(0);
    });

    it('should NOT capture opponent piece on a safe square', () => {
      const redPlayer = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 5, state: TokenState.ACTIVE, stepCount: 6 },
      ]);
      const bluePlayer = createMockPlayer(PlayerColor.BLUE, [
        { id: 0, pos: 8, state: TokenState.ACTIVE, stepCount: 48 }, // 8 is SAFE square
      ]);
      const match = engine.createMatch('match-safe', [redPlayer, bluePlayer]);

      // Red rolls 3, landing on 8
      const val = engine.validateMove(match, PlayerColor.RED, 0, 3);
      expect(val.valid).toBe(true);
      expect(val.newPosition).toBe(8);
      expect(val.captured).toBeUndefined();

      engine.applyMove(match, PlayerColor.RED, 0, 3);
      expect(bluePlayer.tokens[0].position).toBe(8);
      expect(bluePlayer.tokens[0].state).toBe(TokenState.ACTIVE);
    });

    it('should not capture pieces of the same color', () => {
      const redPlayer = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 2, state: TokenState.ACTIVE, stepCount: 3 },
        { id: 1, pos: 5, state: TokenState.ACTIVE, stepCount: 6 },
      ]);
      const match = engine.createMatch('match-same-color', [redPlayer]);

      const val = engine.validateMove(match, PlayerColor.RED, 0, 3);
      expect(val.valid).toBe(true);
      expect(val.newPosition).toBe(5);
      expect(val.captured).toBeUndefined();
    });
  });

  describe('Home Column, Overshoot & Home-Runs (SG-B01 & SG-B03)', () => {
    it('should enter home column when stepCount > 51', () => {
      const redPlayer = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 50, state: TokenState.ACTIVE, stepCount: 51 },
      ]);
      const match = engine.createMatch('match-home-col', [redPlayer]);

      // Roll 3 -> stepCount 54 (in home column 52..56)
      const val = engine.validateMove(match, PlayerColor.RED, 0, 3);
      expect(val.valid).toBe(true);
      expect(val.newStepCount).toBe(54);
      expect(val.newPosition).toBe(54);
      expect(val.isFinished).toBe(false);
    });

    it('should reject moves that overshoot GOAL_POSITION (57)', () => {
      const redPlayer = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 55, state: TokenState.ACTIVE, stepCount: 55 },
      ]);
      const match = engine.createMatch('match-overshoot', [redPlayer]);

      // Needs 2 to finish. Rolling 3 or 4 should be rejected as overshoot!
      const val = engine.validateMove(match, PlayerColor.RED, 0, 3);
      expect(val.valid).toBe(false);
      expect(val.reason).toContain('overshoots');
      expect(engine.canMove(redPlayer.tokens[0], 3, PlayerColor.RED)).toBe(false);
    });

    it('should mark piece as FINISHED on exact landing at step 57', () => {
      const redPlayer = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 55, state: TokenState.ACTIVE, stepCount: 55 },
        { id: 1, pos: 0, state: TokenState.ACTIVE, stepCount: 1 },
      ]);
      const match = engine.createMatch('match-finish', [redPlayer]);

      const val = engine.validateMove(match, PlayerColor.RED, 0, 2);
      expect(val.valid).toBe(true);
      expect(val.newPosition).toBe(GOAL_POSITION);
      expect(val.isFinished).toBe(true);

      const applied = engine.applyMove(match, PlayerColor.RED, 0, 2);
      expect(applied.isWinner).toBe(false); // Only 1 token finished so far
      expect(redPlayer.tokens[0].state).toBe(TokenState.FINISHED);
      expect(redPlayer.tokens[0].position).toBe(57);
    });

    it('should trigger match winner when all 4 tokens reach FINISHED', () => {
      const redPlayer = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 57, state: TokenState.FINISHED, stepCount: 57 },
        { id: 1, pos: 57, state: TokenState.FINISHED, stepCount: 57 },
        { id: 2, pos: 57, state: TokenState.FINISHED, stepCount: 57 },
        { id: 3, pos: 56, state: TokenState.ACTIVE, stepCount: 56 },
      ]);
      const match = engine.createMatch('match-win', [redPlayer]);

      const applied = engine.applyMove(match, PlayerColor.RED, 3, 1);
      expect(applied.isWinner).toBe(true);
      expect(applied.match.status).toBe(MatchStatus.FINISHED);
      expect(applied.match.winner).toBe(PlayerColor.RED);
    });
  });

  describe('Turn Management', () => {
    it('should rotate turn order sequentially across 4 players', () => {
      expect(engine.getNextTurn(0)).toBe(1);
      expect(engine.getNextTurn(1)).toBe(2);
      expect(engine.getNextTurn(2)).toBe(3);
      expect(engine.getNextTurn(3)).toBe(0);
    });
  });
});
