import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LeaderboardService } from './leaderboard.service';

describe('LeaderboardService (SG-B05)', () => {
  let service: LeaderboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: any) => {
              if (key === 'REDIS_PORT') return 9999; // invalid port to force in-memory mode
              return defaultVal;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('Key Formatting', () => {
    it('should format day and week keys consistently', () => {
      const fixedDate = new Date('2026-09-10T12:00:00Z');
      expect(service.getDayKey(fixedDate)).toBe('2026-09-10');
      expect(service.getWeekKey(fixedDate)).toMatch(/^2026-W\d{2}$/);
    });

    it('should construct set keys for all_time, weekly, and daily', () => {
      const fixedDate = new Date('2026-09-10T12:00:00Z');
      expect(service.getSetKey('wins', 'all_time', fixedDate)).toBe('leaderboard:wins:all_time');
      expect(service.getSetKey('kills', 'daily', fixedDate)).toBe('leaderboard:kills:daily:2026-09-10');
    });
  });

  describe('Win and Earnings Recording', () => {
    it('should record player wins and earnings into sorted sets', async () => {
      const p1 = 'GPLAYER1_ALICE';
      const p2 = 'GPLAYER2_BOB';

      await service.recordWin(p1, 0.76);
      await service.recordWin(p1, 0.76);
      await service.recordWin(p2, 0.76);

      const winBoard = await service.getLeaderboard('wins', 'all_time');
      expect(winBoard).toHaveLength(2);
      expect(winBoard[0].walletAddress).toBe(p1);
      expect(winBoard[0].score).toBe(2);
      expect(winBoard[0].rank).toBe(1);

      expect(winBoard[1].walletAddress).toBe(p2);
      expect(winBoard[1].score).toBe(1);
      expect(winBoard[1].rank).toBe(2);

      const earningsBoard = await service.getLeaderboard('earnings', 'all_time');
      expect(earningsBoard[0].walletAddress).toBe(p1);
      expect(earningsBoard[0].score).toBeCloseTo(1.52, 2);
    });

    it('should record kills/captures and compute accurate player ranks', async () => {
      const killer = 'GKILLER_99';
      await service.recordCapture(killer, 0.05);
      await service.recordCapture(killer, 0.05);
      await service.recordCapture(killer, 0.05);

      const rankInfo = await service.getPlayerRank(killer, 'kills', 'all_time');
      expect(rankInfo.rank).toBe(1);
      expect(rankInfo.score).toBe(3);
    });
  });

  describe('Pagination & Timeframe Filtering', () => {
    it('should paginate leaderboard results with limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        for (let w = 0; w < i; w++) {
          await service.recordWin(`GWALLET_${i}`, 0.1);
        }
      }

      // Top 2: WALLET_5 (5 wins), WALLET_4 (4 wins)
      const page1 = await service.getLeaderboard('wins', 'all_time', 2, 0);
      expect(page1).toHaveLength(2);
      expect(page1[0].walletAddress).toBe('GWALLET_5');
      expect(page1[0].rank).toBe(1);
      expect(page1[1].walletAddress).toBe('GWALLET_4');
      expect(page1[1].rank).toBe(2);

      // Page 2: WALLET_3 (3 wins), WALLET_2 (2 wins)
      const page2 = await service.getLeaderboard('wins', 'all_time', 2, 2);
      expect(page2).toHaveLength(2);
      expect(page2[0].walletAddress).toBe('GWALLET_3');
      expect(page2[0].rank).toBe(3);
      expect(page2[1].walletAddress).toBe('GWALLET_2');
      expect(page2[1].rank).toBe(4);
    });
  });
});
