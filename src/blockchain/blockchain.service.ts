import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BASE_BUY_IN_XLM,
  CAPTURE_REWARD_XLM,
  PLATFORM_RAKE_PERCENT,
} from '../common/constants';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);

  /** Stellar/Soroban RPC URL */
  private readonly sorobanRpcUrl: string;
  /** Stellar Horizon URL */
  private readonly horizonUrl: string;
  /** Deployed contract ID */
  private contractId: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.sorobanRpcUrl =
      this.configService.get<string>('SOROBAN_RPC_URL') ||
      'https://soroban-testnet.stellar.org';
    this.horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';
    this.contractId = this.configService.get<string>('CONTRACT_ID');
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `BlockchainService initialized. Network: ${this.horizonUrl}`,
    );
    if (this.contractId) {
      this.logger.log(`Contract ID: ${this.contractId}`);
    } else {
      this.logger.warn('No CONTRACT_ID configured. Deploy contract first.');
    }
  }

  /**
   * Initialize a match on-chain (escrow buy-ins).
   * Calls the Soroban contract's initialize_match function.
   */
  async initializeMatchOnChain(
    matchId: string,
    players: { walletAddress: string }[],
  ): Promise<string> {
    // TODO: Implement Soroban contract call
    // 1. Build contract invocation for initialize_match
    // 2. Sign with server key
    // 3. Submit to Soroban RPC
    // 4. Return transaction hash
    this.logger.log(
      `Initializing match ${matchId} on-chain with ${players.length} players`,
    );
    return `tx_placeholder_${matchId}`;
  }

  /**
   * Execute a capture payout on-chain.
   * Calls the Soroban contract's execute_capture function.
   */
  async executeCapture(
    matchId: string,
    fromWallet: string,
    toWallet: string,
  ): Promise<string> {
    // TODO: Implement Soroban contract call for capture payout
    this.logger.log(
      `Executing capture: ${fromWallet} → ${toWallet} (${CAPTURE_REWARD_XLM} XLM)`,
    );
    return `tx_capture_${Date.now()}`;
  }

  /**
   * Execute winner payout on-chain.
   * Calls the Soroban contract's distribute_winnings function.
   */
  async executeWinnerPayout(
    matchId: string,
    winnerWallet: string,
    amount: string,
  ): Promise<string> {
    // TODO: Implement Soroban contract call for winner payout
    this.logger.log(
      `Winner payout: ${winnerWallet} receives ${amount} XLM`,
    );
    return `tx_winner_${Date.now()}`;
  }

  /**
   * Collect platform rake and issue loss tickets.
   */
  async collectRakeAndIssueTickets(
    matchId: string,
    losers: { walletAddress: string; tokensLost: number }[],
  ): Promise<void> {
    // TODO: Implement rake collection and loss ticket issuance
    const rakeAmount = BASE_BUY_IN_XLM * (PLATFORM_RAKE_PERCENT / 100);
    this.logger.log(
      `Collecting rake: ${rakeAmount} XLM from match ${matchId}`,
    );

    for (const loser of losers) {
      const tickets = loser.tokensLost;
      this.logger.log(
        `Issuing ${tickets} loss tickets to ${loser.walletAddress}`,
      );
    }
  }

  /**
   * Get the deployed contract ID.
   */
  getContractId(): string | undefined {
    return this.contractId;
  }

  /**
   * Set the contract ID after deployment.
   */
  setContractId(contractId: string): void {
    this.contractId = contractId;
    this.logger.log(`Contract ID set to: ${contractId}`);
  }
}
