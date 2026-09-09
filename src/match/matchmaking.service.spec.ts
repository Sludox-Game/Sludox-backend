import { Test, TestingModule } from '@nestjs/testing';
import { MatchmakingService } from './matchmaking.service';
import { LudoEngine } from './ludo-engine.service';
import { SeatType, MatchStatus, PlayerColor } from '../common/enums';
import { MatchmakingEntry } from '../common/interfaces';

describe('MatchmakingService (SG-B04)', () => {
  let service: MatchmakingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MatchmakingService, LudoEngine],
    }).compile();

    service = module.get<MatchmakingService>(MatchmakingService);
  });

  describe('Elo Buckets and Compatibility', () => {
    it('should calculate expanding Elo tolerance over queue wait time', () => {
      const entry: MatchmakingEntry = {
        userId: 'u1',
        walletAddress: 'G1',
        stake: 0.2,
        joinedAt: 1000,
        elo: 1200,
      };

      // At joined time: base tolerance = 100
      expect(service.calculateTolerance(entry, 1000)).toBe(100);

      // After 5s: +50 -> 150
      expect(service.calculateTolerance(entry, 6000)).toBe(150);

      // After 10s: +100 -> 200
      expect(service.calculateTolerance(entry, 11000)).toBe(200);
    });

    it('should match players with similar Elo rating and reject disparate Elo initially', () => {
      const now = 10000;
      const p1: MatchmakingEntry = { userId: 'p1', walletAddress: 'G1', stake: 0.2, joinedAt: now, elo: 1200 };
      const p2: MatchmakingEntry = { userId: 'p2', walletAddress: 'G2', stake: 0.2, joinedAt: now, elo: 1250 };
      const p3: MatchmakingEntry = { userId: 'p3', walletAddress: 'G3', stake: 0.2, joinedAt: now, elo: 1500 }; // 300 diff

      expect(service.areEntriesCompatible(p1, p2, now)).toBe(true);
      expect(service.areEntriesCompatible(p1, p3, now)).toBe(false); // exceeds 100 initial tolerance
    });

    it('should match disparate Elo once queue time has expanded tolerance', () => {
      const p1: MatchmakingEntry = { userId: 'p1', walletAddress: 'G1', stake: 0.2, joinedAt: 0, elo: 1200 };
      const p2: MatchmakingEntry = { userId: 'p2', walletAddress: 'G2', stake: 0.2, joinedAt: 0, elo: 1450 }; // 250 diff

      // At t=0, diff=250 > 100
      expect(service.areEntriesCompatible(p1, p2, 0)).toBe(false);

      // At t=20,000ms (4 cycles * 50 = +200 -> tol 300)
      expect(service.areEntriesCompatible(p1, p2, 20000)).toBe(true);
    });
  });

  describe('4-Player Match Formation', () => {
    it('should automatically form a match when 4 compatible players join', async () => {
      await service.addToQueue({ userId: 'p1', walletAddress: 'G1', stake: 0.2, joinedAt: Date.now(), elo: 1200 });
      await service.addToQueue({ userId: 'p2', walletAddress: 'G2', stake: 0.2, joinedAt: Date.now(), elo: 1220 });
      await service.addToQueue({ userId: 'p3', walletAddress: 'G3', stake: 0.2, joinedAt: Date.now(), elo: 1190 });
      expect(service.getQueueSize()).toBe(3);

      const match = await service.addToQueue({
        userId: 'p4',
        walletAddress: 'G4',
        stake: 0.2,
        joinedAt: Date.now(),
        elo: 1210,
      });

      expect(match).toBeDefined();
      expect(match?.players).toHaveLength(4);
      expect(match?.status).toBe(MatchStatus.STARTED);
      expect(service.getQueueSize()).toBe(0);
    });
  });

  describe('30-Second Timeout AI Bot Spawning (SG-B04)', () => {
    it('should spawn AI bots to fill remainder when queue wait exceeds 30 seconds', () => {
      const now = Date.now();
      // Player joined 35 seconds ago
      service.addToQueue({
        userId: 'human_1',
        walletAddress: 'GHUMAN1',
        stake: 0.2,
        joinedAt: now - 35000,
        elo: 1200,
      });

      expect(service.getQueueSize()).toBe(1);

      const timeoutMatches = service.checkTimeouts(now);
      expect(timeoutMatches).toHaveLength(1);

      const match = timeoutMatches[0];
      expect(match.players).toHaveLength(4);

      // First player is human
      expect(match.players[0].userId).toBe('human_1');
      expect(match.players[0].seatType).toBe(SeatType.HUMAN);

      // Remaining 3 players are intelligent AI bots
      expect(match.players[1].seatType).toBe(SeatType.AI);
      expect(match.players[2].seatType).toBe(SeatType.AI);
      expect(match.players[3].seatType).toBe(SeatType.AI);
      expect(match.players[1].userId).toContain('ai_bot');

      // Queue is cleared
      expect(service.getQueueSize()).toBe(0);
    });

    it('should fill remainder with AI bots when 2 humans are queued for >30s', () => {
      const now = Date.now();
      service.addToQueue({
        userId: 'human_1',
        walletAddress: 'GHUMAN1',
        stake: 0.2,
        joinedAt: now - 35000,
        elo: 1200,
      });
      service.addToQueue({
        userId: 'human_2',
        walletAddress: 'GHUMAN2',
        stake: 0.2,
        joinedAt: now - 32000,
        elo: 1210,
      });

      const matches = service.checkTimeouts(now);
      expect(matches).toHaveLength(1);
      const match = matches[0];

      const humans = match.players.filter((p) => p.seatType === SeatType.HUMAN);
      const bots = match.players.filter((p) => p.seatType === SeatType.AI);

      expect(humans).toHaveLength(2);
      expect(bots).toHaveLength(2);
    });
  });
});
