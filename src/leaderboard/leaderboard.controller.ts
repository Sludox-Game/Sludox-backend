import { Controller, Get, Query, Param } from '@nestjs/common';
import {
  LeaderboardService,
  LeaderboardMetric,
  LeaderboardTimeframe,
} from './leaderboard.service';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get(':metric')
  async getLeaderboard(
    @Param('metric') metric: LeaderboardMetric,
    @Query('timeframe') timeframe: LeaderboardTimeframe = 'all_time',
    @Query('limit') limit = 10,
    @Query('offset') offset = 0,
  ) {
    return this.leaderboardService.getLeaderboard(
      metric,
      timeframe,
      Number(limit) || 10,
      Number(offset) || 0,
    );
  }

  @Get(':metric/player/:walletAddress')
  async getPlayerRank(
    @Param('metric') metric: LeaderboardMetric,
    @Param('walletAddress') walletAddress: string,
    @Query('timeframe') timeframe: LeaderboardTimeframe = 'all_time',
  ) {
    return this.leaderboardService.getPlayerRank(
      walletAddress,
      metric,
      timeframe,
    );
  }
}
