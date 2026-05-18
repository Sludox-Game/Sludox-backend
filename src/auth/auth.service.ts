import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESSION_KEY_EXPIRY_MINUTES } from '../common/constants';
import { SessionKeyPayload } from '../common/interfaces';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Verify a wallet signature and create a session key.
   * In MVP, this validates the signed challenge from Freighter/Albedo.
   */
  async verifyWalletSignature(
    walletAddress: string,
    signature: string,
    challenge: string,
  ): Promise<boolean> {
    // TODO: Implement Stellar wallet signature verification
    // 1. Reconstruct the challenge message
    // 2. Use stellar-sdk to verify the signature against walletAddress
    // 3. Return true if valid
    this.logger.log(`Verifying signature for wallet: ${walletAddress}`);
    return true; // Placeholder
  }

  /**
   * Generate an ephemeral session key scoped to a specific match.
   * The session key is a random keypair generated server-side,
   * authorized by the user's main wallet via a one-time signature.
   */
  async createSessionKey(
    walletAddress: string,
    matchId: string,
  ): Promise<SessionKeyPayload> {
    // TODO: Implement session key generation
    // 1. Generate ephemeral Stellar keypair
    // 2. Store mapping: sessionKey → { walletAddress, matchId, expiresAt }
    // 3. Return session key payload
    const expiresAt = Date.now() + SESSION_KEY_EXPIRY_MINUTES * 60 * 1000;

    const sessionKeyPayload: SessionKeyPayload = {
      sessionKey: `sk_${walletAddress.slice(0, 8)}_${matchId.slice(0, 8)}`,
      walletAddress,
      matchId,
      expiresAt,
    };

    this.logger.log(
      `Session key created for ${walletAddress} in match ${matchId}`,
    );
    return sessionKeyPayload;
  }

  /**
   * Validate that a session key is still valid (not expired, correct scope).
   */
  async validateSessionKey(
    sessionKey: string,
    matchId: string,
  ): Promise<boolean> {
    // TODO: Check Redis for session key validity and expiry
    return true; // Placeholder
  }

  /**
   * Revoke a session key (e.g., on match end or disconnect).
   */
  async revokeSessionKey(sessionKey: string): Promise<void> {
    this.logger.log(`Revoking session key: ${sessionKey}`);
    // TODO: Remove from Redis
  }
}
