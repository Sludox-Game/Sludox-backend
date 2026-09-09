import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { MatchService } from './match.service';
import { LudoEngine } from './ludo-engine.service';
import { AiPlayerService } from './ai-player.service';
import { MatchmakingService } from './matchmaking.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { VoiceService } from '../voice/voice.service';
import { PlayerColor, TokenState, MatchStatus, SeatType } from '../common/enums';
import { Match, Player } from '../common/interfaces';
import { QUEUES } from '../common/constants';

describe('MatchService (SG-B01, SG-B02, SG-B05, SG-B06)', () => {
  let service: MatchService;
  let ludoEngine: LudoEngine;
  let matchmakingService: MatchmakingService;
  let mockQueue: { add: jest.Mock };
  let mockLeaderboard: { recordWin: jest.Mock; recordCapture: jest.Mock };
  let mockVoice: { cleanupMatchRoom: jest.Mock };

  const createMockPlayer = (
    color: PlayerColor,
    tokens: Array<{ id: number; pos: number; state: TokenState; stepCount?: number }>,
    wallet = `G${color.toUpperCase()}`,
  ): Player => ({
    userId: `user_${color}`,
    walletAddress: wallet,
    color,
    seatType: SeatType.HUMAN,
    tokens: tokens.map((t) => ({
      id: t.id,
      position: t.pos,
      state: t.state,
      stepCount: t.stepCount ?? (t.pos === -1 ? 0 : 1),
    })),
    timeoutStrikes: 0,
    isConnected: true,
  });

  beforeEach(async () => {
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    mockLeaderboard = {
      recordWin: jest.fn().mockResolvedValue(undefined),
      recordCapture: jest.fn().mockResolvedValue(undefined),
    };
    mockVoice = { cleanupMatchRoom: jest.fn().mockReturnValue({ cleanedRoom: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchService,
        LudoEngine,
        AiPlayerService,
        MatchmakingService,
        {
          provide: getQueueToken(QUEUES.TRANSACTION),
          useValue: mockQueue,
        },
        {
          provide: LeaderboardService,
          useValue: mockLeaderboard,
        },
        {
          provide: VoiceService,
          useValue: mockVoice,
        },
      ],
    }).compile();

    service = module.get<MatchService>(MatchService);
    ludoEngine = module.get<LudoEngine>(LudoEngine);
    matchmakingService = module.get<MatchmakingService>(MatchmakingService);
  });

  describe('Match Lifecycle and Turns', () => {
    it('should start a match and initialize turn timers', () => {
      const matchId = 'test-match-1';
      const players = [
        createMockPlayer(PlayerColor.RED, [{ id: 0, pos: -1, state: TokenState.HOME }]),
        createMockPlayer(PlayerColor.BLUE, [{ id: 0, pos: -1, state: TokenState.HOME }]),
      ];
      const match = ludoEngine.createMatch(matchId, players);
      matchmakingService.updateMatch(matchId, match);

      const started = service.startMatch(matchId);
      expect(started).toBeDefined();
      expect(started?.status).toBe(MatchStatus.STARTED);
      expect(started?.currentTurnIndex).toBe(0);
      expect(started?.hasRolled).toBe(false);
    });

    it('should reject roll if not current player turn', () => {
      const matchId = 'test-match-2';
      const players = [
        createMockPlayer(PlayerColor.RED, [{ id: 0, pos: -1, state: TokenState.HOME }]),
        createMockPlayer(PlayerColor.BLUE, [{ id: 0, pos: -1, state: TokenState.HOME }]),
      ];
      const match = service.startMatch(matchId);
      matchmakingService.updateMatch(matchId, { ...ludoEngine.createMatch(matchId, players), status: MatchStatus.STARTED });

      const res = service.handleRollDice(matchId, PlayerColor.BLUE);
      expect(res).toBeNull();
    });

    it('should advance turn automatically if rolled number has no valid moves', () => {
      const matchId = 'test-auto-turn';
      // Red has tokens in HOME (requires 6)
      const red = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: -1, state: TokenState.HOME, stepCount: 0 },
      ]);
      const blue = createMockPlayer(PlayerColor.BLUE, [
        { id: 0, pos: -1, state: TokenState.HOME, stepCount: 0 },
      ]);
      const match = { ...ludoEngine.createMatch(matchId, [red, blue]), status: MatchStatus.STARTED };
      matchmakingService.updateMatch(matchId, match);

      // Force roll to 3 (which cannot move a HOME token)
      jest.spyOn(ludoEngine, 'rollDice').mockReturnValue({ value: 3, isDouble: false });

      const res = service.handleRollDice(matchId, PlayerColor.RED);
      expect(res).toBeDefined();
      expect(res?.diceRoll.value).toBe(3);
      expect(res?.autoTurnAdvanced).toBe(true);
      // Turn rotated to blue (index 1)
      expect(res?.match.currentTurnIndex).toBe(1);
      expect(res?.match.hasRolled).toBe(false);
    });
  });

  describe('Move Token & Leaderboard/Payout Integration', () => {
    it('should execute move, trigger capture payout, and record kill to leaderboard', async () => {
      const matchId = 'match-capture-test';
      const red = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 5, state: TokenState.ACTIVE, stepCount: 6 },
      ]);
      const blue = createMockPlayer(PlayerColor.BLUE, [
        { id: 0, pos: 9, state: TokenState.ACTIVE, stepCount: 49 },
      ]);
      const match = {
        ...ludoEngine.createMatch(matchId, [red, blue]),
        status: MatchStatus.STARTED,
        currentTurnIndex: 0,
        hasRolled: true,
        currentDiceRoll: { value: 4, isDouble: false },
      };
      matchmakingService.updateMatch(matchId, match);

      const moveResult = await service.handleMoveToken(matchId, PlayerColor.RED, 0);
      expect(moveResult).toBeDefined();
      expect(moveResult?.captured).toBeDefined();
      expect(moveResult?.captured?.color).toBe(PlayerColor.BLUE);

      // BullMQ transaction queued
      expect(mockQueue.add).toHaveBeenCalledWith('capture-payout', expect.objectContaining({
        type: 'capture_payout',
        matchId,
        amount: '0.05',
      }));

      // Leaderboard kill recorded
      expect(mockLeaderboard.recordCapture).toHaveBeenCalledWith(red.walletAddress, 0.05);
    });

    it('should execute final move, declare winner, cleanup voice, and record win', async () => {
      const matchId = 'match-win-test';
      const red = createMockPlayer(PlayerColor.RED, [
        { id: 0, pos: 57, state: TokenState.FINISHED, stepCount: 57 },
        { id: 1, pos: 57, state: TokenState.FINISHED, stepCount: 57 },
        { id: 2, pos: 57, state: TokenState.FINISHED, stepCount: 57 },
        { id: 3, pos: 56, state: TokenState.ACTIVE, stepCount: 56 },
      ]);
      const match = {
        ...ludoEngine.createMatch(matchId, [red]),
        status: MatchStatus.STARTED,
        currentTurnIndex: 0,
        hasRolled: true,
        currentDiceRoll: { value: 1, isDouble: false },
      };
      matchmakingService.updateMatch(matchId, match);

      const moveResult = await service.handleMoveToken(matchId, PlayerColor.RED, 3);
      expect(moveResult).toBeDefined();
      expect(moveResult?.isWinner).toBe(true);
      expect(moveResult?.match.status).toBe(MatchStatus.FINISHED);

      // Winner payout queued in BullMQ
      expect(mockQueue.add).toHaveBeenCalledWith('winner-payout', expect.objectContaining({
        type: 'winner_payout',
        toWallet: red.walletAddress,
      }));

      // Leaderboard win recorded
      expect(mockLeaderboard.recordWin).toHaveBeenCalledWith(red.walletAddress, expect.any(Number));

      // Voice room cleaned up
      expect(mockVoice.cleanupMatchRoom).toHaveBeenCalledWith(matchId);
    });
  });

  describe('Timeout and Disconnect Handling', () => {
    it('should increment timeout strikes and convert to AI after 2 strikes', () => {
      const matchId = 'match-timeout-test';
      const red = createMockPlayer(PlayerColor.RED, [{ id: 0, pos: 0, state: TokenState.ACTIVE }]);
      const blue = createMockPlayer(PlayerColor.BLUE, [{ id: 0, pos: 13, state: TokenState.ACTIVE }]);
      const match = {
        ...ludoEngine.createMatch(matchId, [red, blue]),
        status: MatchStatus.STARTED,
        currentTurnIndex: 0,
      };
      matchmakingService.updateMatch(matchId, match);

      service.handleTimeout(matchId, PlayerColor.RED);
      expect(red.timeoutStrikes).toBe(1);
      expect(red.seatType).toBe(SeatType.HUMAN);

      // Second strike
      service.handleTimeout(matchId, PlayerColor.RED);
      expect(red.timeoutStrikes).toBe(2);
      expect(red.seatType).toBe(SeatType.AI);
    });

    it('should convert to AI immediately on disconnect', () => {
      const matchId = 'match-dc-test';
      const red = createMockPlayer(PlayerColor.RED, [{ id: 0, pos: 0, state: TokenState.ACTIVE }]);
      const match = {
        ...ludoEngine.createMatch(matchId, [red]),
        status: MatchStatus.STARTED,
      };
      matchmakingService.updateMatch(matchId, match);

      service.handleDisconnect(matchId, PlayerColor.RED);
      expect(red.isConnected).toBe(false);
      expect(red.seatType).toBe(SeatType.AI);
    });
  });
});
