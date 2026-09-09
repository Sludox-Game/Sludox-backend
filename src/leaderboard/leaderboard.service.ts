import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CAPTURE_REWARD_XLM, REDIS_KEYS } from '../common/constants';

export type LeaderboardMetric = 'wins' | 'kills' | 'earnings';
export type LeaderboardTimeframe = 'all_time' | 'weekly' | 'daily';

export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  score: number;
}

@Injectable()
export class LeaderboardService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderboardService.name);
  private redisClient: Redis | null = null;
  private isRedisConnected = false;

  /** In-memory fallback sorted sets: key -> Map<walletAddress, score> */
  private readonly inMemoryStore = new Map<string, Map<string, number>>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = Number(this.configService.get<number>('REDIS_PORT', 6379));
    const password = this.configService.get<string>('REDIS_PASSWORD') || undefined;

    try {
      this.redisClient = new Redis({
        host,
        port,
        password,
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // don't infinite retry in tests
      });

      this.redisClient.on('error', (err) => {
        this.logger.warn(`Redis connection error, using in-memory store: ${err.message}`);
        this.isRedisConnected = false;
      });

      await this.redisClient.connect();
      this.isRedisConnected = true;
      this.logger.log(`Connected to Redis for leaderboard on ${host}:${port}`);
    } catch (error) {
      this.logger.warn(
        `Could not connect to Redis (${(error as Error).message}), fallback to in-memory store`,
      );
      this.isRedisConnected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        // ignore disconnect errors
      }
    }
  }

  /**
   * Helper to format current UTC day key (YYYY-MM-DD).
   */
  getDayKey(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Helper to format ISO week key (YYYY-Www).
   */
  getWeekKey(d = new Date()): string {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  /**
   * Build the Redis sorted set key for a metric and timeframe.
   */
  getSetKey(metric: LeaderboardMetric, timeframe: LeaderboardTimeframe, date = new Date()): string {
    const prefix = REDIS_KEYS.LEADERBOARD || 'leaderboard:';
    if (timeframe === 'all_time') {
      return `${prefix}${metric}:all_time`;
    }
    if (timeframe === 'weekly') {
      return `${prefix}${metric}:weekly:${this.getWeekKey(date)}`;
    }
    return `${prefix}${metric}:daily:${this.getDayKey(date)}`;
  }

  /**
   * Record a match win for a player into Redis sorted sets (ZINCRBY / ZADD).
   */
  async recordWin(
    walletAddress: string,
    amountXlm = 0,
    date = new Date(),
  ): Promise<void> {
    const timeframes: LeaderboardTimeframe[] = ['all_time', 'weekly', 'daily'];

    for (const tf of timeframes) {
      const winKey = this.getSetKey('wins', tf, date);
      await this.incrementScore(winKey, walletAddress, 1);

      if (amountXlm > 0) {
        const earnKey = this.getSetKey('earnings', tf, date);
        await this.incrementScore(earnKey, walletAddress, amountXlm);
      }
    }

    this.logger.log(
      `Recorded win for ${walletAddress} (earned ${amountXlm} XLM)`,
    );
  }

  /**
   * Record an in-game piece capture (kill count) for a player.
   */
  async recordCapture(
    walletAddress: string,
    rewardXlm = CAPTURE_REWARD_XLM,
    date = new Date(),
  ): Promise<void> {
    const timeframes: LeaderboardTimeframe[] = ['all_time', 'weekly', 'daily'];

    for (const tf of timeframes) {
      const killKey = this.getSetKey('kills', tf, date);
      await this.incrementScore(killKey, walletAddress, 1);

      if (rewardXlm > 0) {
        const earnKey = this.getSetKey('earnings', tf, date);
        await this.incrementScore(earnKey, walletAddress, rewardXlm);
      }
    }

    this.logger.log(
      `Recorded capture for ${walletAddress} (reward: ${rewardXlm} XLM)`,
    );
  }

  /**
   * Get top ranked players via Redis ZREVRANGE with scores.
   */
  async getLeaderboard(
    metric: LeaderboardMetric,
    timeframe: LeaderboardTimeframe = 'all_time',
    limit = 10,
    offset = 0,
    date = new Date(),
  ): Promise<LeaderboardEntry[]> {
    const key = this.getSetKey(metric, timeframe, date);

    if (this.isRedisConnected && this.redisClient) {
      try {
        const raw = await this.redisClient.zrevrange(
          key,
          offset,
          offset + limit - 1,
          'WITHSCORES',
        );

        const results: LeaderboardEntry[] = [];
        for (let i = 0; i < raw.length; i += 2) {
          results.push({
            rank: offset + Math.floor(i / 2) + 1,
            walletAddress: raw[i],
            score: parseFloat(raw[i + 1]),
          });
        }
        return results;
      } catch (err) {
        this.logger.warn(`Redis zrevrange error: ${(err as Error).message}`);
      }
    }

    // In-memory fallback
    const map = this.inMemoryStore.get(key) || new Map<string, number>();
    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const sliced = sorted.slice(offset, offset + limit);

    return sliced.map(([walletAddress, score], index) => ({
      rank: offset + index + 1,
      walletAddress,
      score,
    }));
  }

  /**
   * Get a specific player's rank and score in a leaderboard.
   */
  async getPlayerRank(
    walletAddress: string,
    metric: LeaderboardMetric,
    timeframe: LeaderboardTimeframe = 'all_time',
    date = new Date(),
  ): Promise<{ rank: number | null; score: number }> {
    const key = this.getSetKey(metric, timeframe, date);

    if (this.isRedisConnected && this.redisClient) {
      try {
        const rank = await this.redisClient.zrevrank(key, walletAddress);
        const scoreStr = await this.redisClient.zscore(key, walletAddress);
        return {
          rank: rank !== null ? rank + 1 : null,
          score: scoreStr ? parseFloat(scoreStr) : 0,
        };
      } catch (err) {
        this.logger.warn(`Redis rank lookup error: ${(err as Error).message}`);
      }
    }

    // In-memory fallback
    const map = this.inMemoryStore.get(key);
    if (!map || !map.has(walletAddress)) {
      return { rank: null, score: 0 };
    }

    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const index = sorted.findIndex(([w]) => w === walletAddress);

    return {
      rank: index !== -1 ? index + 1 : null,
      score: map.get(walletAddress) ?? 0,
    };
  }

  /**
   * Internal helper to atomically increment score in Redis or in-memory fallback.
   */
  private async incrementScore(
    key: string,
    member: string,
    incrementBy: number,
  ): Promise<number> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        const newScore = await this.redisClient.zincrby(key, incrementBy, member);
        return parseFloat(newScore);
      } catch (err) {
        this.logger.warn(`Redis zincrby error: ${(err as Error).message}`);
      }
    }

    // In-memory fallback
    if (!this.inMemoryStore.has(key)) {
      this.inMemoryStore.set(key, new Map());
    }
    const map = this.inMemoryStore.get(key)!;
    const current = map.get(member) || 0;
    const updated = Math.round((current + incrementBy) * 10000) / 10000;
    map.set(member, updated);
    return updated;
  }
}
