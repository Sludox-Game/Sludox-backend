import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from './auth/auth.module';
import { MatchModule } from './match/match.module';
import { VoiceModule } from './voice/voice.module';
import { BlockchainModule } from './blockchain/blockchain.module';

@Module({
  imports: [
    // ── Environment Configuration ──
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── PostgreSQL (TypeORM) ──
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      username: process.env.DATABASE_USER || 'sludox',
      password: process.env.DATABASE_PASSWORD || 'sludox_dev',
      database: process.env.DATABASE_NAME || 'sludox',
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
    }),

    // ── Redis / BullMQ ──
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),

    // ── Scheduled Tasks ──
    ScheduleModule.forRoot(),

    // ── Domain Modules ──
    AuthModule,
    MatchModule,
    VoiceModule,
    BlockchainModule,
  ],
})
export class AppModule {}
