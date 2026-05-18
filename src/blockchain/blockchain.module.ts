import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BlockchainService } from './blockchain.service';
import { TransactionProcessor } from './transaction.processor';
import { QUEUES } from '../common/constants';

@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: QUEUES.TRANSACTION,
      },
      {
        name: QUEUES.REBATE,
      },
    ),
  ],
  providers: [BlockchainService, TransactionProcessor],
  exports: [BlockchainService],
})
export class BlockchainModule {}
