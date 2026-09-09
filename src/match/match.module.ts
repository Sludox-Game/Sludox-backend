import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MatchGateway } from './match.gateway';
import { MatchService } from './match.service';
import { MatchmakingService } from './matchmaking.service';
import { LudoEngine } from './ludo-engine.service';
import { AiPlayerService } from './ai-player.service';
import { QUEUES } from '../common/constants';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { VoiceModule } from '../voice/voice.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.TRANSACTION,
    }),
    LeaderboardModule,
    VoiceModule,
    AuthModule,
  ],
  providers: [
    MatchGateway,
    MatchService,
    MatchmakingService,
    LudoEngine,
    AiPlayerService,
  ],
  exports: [MatchService, MatchmakingService],
})
export class MatchModule {}

