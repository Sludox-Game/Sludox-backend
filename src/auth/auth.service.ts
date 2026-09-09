import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from 'stellar-sdk';
import { randomBytes } from 'crypto';
import { SESSION_KEY_EXPIRY_MINUTES } from '../common/constants';
import { SessionKeyPayload } from '../common/interfaces';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** Active session keys: sessionPublicKey -> SessionKeyPayload */
  private readonly sessions = new Map<string, SessionKeyPayload>();

  /** Pending challenges: challengeString -> { walletAddress, expiresAt } */
  private readonly pendingChallenges = new Map<
    string,
    { walletAddress: string; expiresAt: number }
  >();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Generate a cryptographic challenge for wallet authentication.
   */
  generateChallenge(walletAddress: string): { challenge: string; expiresAt: number } {
    const nonce = randomBytes(16).toString('hex');
    const challenge = `sludox_auth_${Date.now()}_${nonce}`;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    this.pendingChallenges.set(challenge, { walletAddress, expiresAt });
    return { challenge, expiresAt };
  }

  /**
   * Verify a wallet signature and create a session key.
   * Validates signed challenges from Freighter, Albedo, or standard Stellar Keypairs.
   */
  async verifyWalletSignature(
    walletAddress: string,
    signature: string,
    challenge: string,
  ): Promise<boolean> {
    this.logger.log(`Verifying signature for wallet: ${walletAddress}`);

    // Check challenge validity if stored
    const pending = this.pendingChallenges.get(challenge);
    if (pending && pending.walletAddress !== walletAddress) {
      this.logger.warn(`Wallet mismatch for challenge: expected ${pending.walletAddress}, got ${walletAddress}`);
      return false;
    }
    if (pending && pending.expiresAt < Date.now()) {
      this.logger.warn(`Challenge expired for wallet: ${walletAddress}`);
      this.pendingChallenges.delete(challenge);
      return false;
    }

    // Support mock signature in development/testing
    if (signature === 'mock_signature' || signature.startsWith('mock_sig_')) {
      if (pending) this.pendingChallenges.delete(challenge);
      return true;
    }

    try {
      const keypair = Keypair.fromPublicKey(walletAddress);
      const data = Buffer.from(challenge, 'utf8');

      // Try base64 signature (Freighter standard) or hex
      let sigBuffer: Buffer;
      if (/^[0-9a-fA-F]+$/.test(signature) && signature.length === 128) {
        sigBuffer = Buffer.from(signature, 'hex');
      } else {
        sigBuffer = Buffer.from(signature, 'base64');
      }

      const isValid = keypair.verify(data, sigBuffer);
      if (isValid && pending) {
        this.pendingChallenges.delete(challenge);
      }
      return isValid;
    } catch (error) {
      this.logger.warn(
        `Stellar signature verification error for ${walletAddress}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Generate an ephemeral Ed25519 session keypair scoped to a specific match.
   * Allows gasless in-game micro-moves signed directly in memory without wallet popups.
   */
  async createSessionKey(
    walletAddress: string,
    matchId: string,
  ): Promise<SessionKeyPayload> {
    const keypair = Keypair.random();
    const sessionPublicKey = keypair.publicKey();
    const sessionSecret = keypair.secret();
    const expiresAt = Date.now() + SESSION_KEY_EXPIRY_MINUTES * 60 * 1000;

    const sessionPayload: SessionKeyPayload = {
      sessionKey: sessionPublicKey,
      sessionPublicKey,
      sessionSecret,
      walletAddress,
      matchId,
      expiresAt,
      authorized: true, // Server-generated and delegated
    };

    this.sessions.set(sessionPublicKey, sessionPayload);

    this.logger.log(
      `Ephemeral Ed25519 session key ${sessionPublicKey.slice(0, 8)}... created for ${walletAddress} in match ${matchId}`,
    );

    return sessionPayload;
  }

  /**
   * Authorize a client-provided session public key via primary wallet delegation signature.
   */
  async authorizeSessionKey(
    walletAddress: string,
    sessionPublicKey: string,
    matchId: string,
    walletSignature: string,
    delegationMessage: string,
  ): Promise<boolean> {
    const isVerified = await this.verifyWalletSignature(
      walletAddress,
      walletSignature,
      delegationMessage,
    );

    if (!isVerified) {
      this.logger.warn(
        `Failed to authorize session key ${sessionPublicKey} for wallet ${walletAddress}`,
      );
      return false;
    }

    const expiresAt = Date.now() + SESSION_KEY_EXPIRY_MINUTES * 60 * 1000;
    const sessionPayload: SessionKeyPayload = {
      sessionKey: sessionPublicKey,
      sessionPublicKey,
      walletAddress,
      matchId,
      expiresAt,
      authorized: true,
    };

    this.sessions.set(sessionPublicKey, sessionPayload);
    this.logger.log(
      `Session key ${sessionPublicKey.slice(0, 8)}... successfully delegated by ${walletAddress} for match ${matchId}`,
    );
    return true;
  }

  /**
   * Validate that a session key is active, not expired, and belongs to the specified match.
   */
  async validateSessionKey(
    sessionKey: string,
    matchId: string,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return false;
    }

    if (session.matchId !== matchId) {
      return false;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionKey);
      return false;
    }

    return session.authorized === true;
  }

  /**
   * Verify an in-game move packet signed with the ephemeral Ed25519 session key.
   */
  async verifySessionSignature(
    sessionKey: string,
    matchId: string,
    dataToVerify: string | object,
    signature: string,
  ): Promise<boolean> {
    const isValidKey = await this.validateSessionKey(sessionKey, matchId);
    if (!isValidKey) {
      return false;
    }

    // Support mock signature in development/testing
    if (signature === 'mock_session_signature' || signature.startsWith('mock_')) {
      return true;
    }

    try {
      const messageString =
        typeof dataToVerify === 'string'
          ? dataToVerify
          : JSON.stringify(dataToVerify);
      const dataBuffer = Buffer.from(messageString, 'utf8');

      let sigBuffer: Buffer;
      if (/^[0-9a-fA-F]+$/.test(signature) && signature.length === 128) {
        sigBuffer = Buffer.from(signature, 'hex');
      } else {
        sigBuffer = Buffer.from(signature, 'base64');
      }

      const keypair = Keypair.fromPublicKey(sessionKey);
      return keypair.verify(dataBuffer, sigBuffer);
    } catch (error) {
      this.logger.warn(
        `Session key signature verification failed for ${sessionKey}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Get an active session payload.
   */
  getSession(sessionKey: string): SessionKeyPayload | undefined {
    return this.sessions.get(sessionKey);
  }

  /**
   * Revoke a session key (on match end or player disconnect).
   */
  async revokeSessionKey(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey);
    this.logger.log(`Revoked session key: ${sessionKey}`);
  }

  /**
   * Revoke all session keys associated with a match.
   */
  async revokeMatchSessions(matchId: string): Promise<void> {
    for (const [key, session] of this.sessions.entries()) {
      if (session.matchId === matchId) {
        this.sessions.delete(key);
      }
    }
  }
}

