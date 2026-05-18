import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { QUEUES } from '../common/constants';
import { TransactionJobData } from '../common/interfaces';

@Processor(QUEUES.TRANSACTION)
export class TransactionProcessor extends WorkerHost {
  private readonly logger = new Logger(TransactionProcessor.name);

  constructor(private readonly blockchainService: BlockchainService) {
    super();
  }

  async process(job: Job<TransactionJobData>): Promise<void> {
    this.logger.log(
      `Processing transaction job [${job.id}]: ${job.data.type}`,
    );

    switch (job.data.type) {
      case 'buy_in':
        await this.handleBuyIn(job.data);
        break;

      case 'capture_payout':
        await this.handleCapturePayout(job.data);
        break;

      case 'winner_payout':
        await this.handleWinnerPayout(job.data);
        break;

      case 'rake_collection':
        await this.handleRakeCollection(job.data);
        break;

      default:
        this.logger.warn(`Unknown transaction type: ${job.data.type}`);
    }
  }

  private async handleBuyIn(data: TransactionJobData): Promise<void> {
    this.logger.log(`Processing buy-in for match ${data.matchId}`);
    // TODO: Call Soroban contract to lock buy-in amount
  }

  private async handleCapturePayout(data: TransactionJobData): Promise<void> {
    if (!data.fromWallet || !data.toWallet) {
      this.logger.error('Capture payout missing wallet addresses');
      return;
    }

    await this.blockchainService.executeCapture(
      data.matchId,
      data.fromWallet,
      data.toWallet,
    );
  }

  private async handleWinnerPayout(data: TransactionJobData): Promise<void> {
    if (!data.toWallet) {
      this.logger.error('Winner payout missing wallet address');
      return;
    }

    await this.blockchainService.executeWinnerPayout(
      data.matchId,
      data.toWallet,
      data.amount,
    );
  }

  private async handleRakeCollection(data: TransactionJobData): Promise<void> {
    this.logger.log(`Processing rake collection for match ${data.matchId}`);
    // TODO: Implement rake collection logic
  }
}
