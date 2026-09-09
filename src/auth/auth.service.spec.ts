import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Keypair } from 'stellar-sdk';
import { AuthService } from './auth.service';

describe('AuthService (SG-B02)', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-value'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('Wallet Challenge and Signature Verification', () => {
    it('should generate cryptographic challenge with expiration', () => {
      const wallet = Keypair.random().publicKey();
      const challengeData = service.generateChallenge(wallet);
      expect(challengeData.challenge).toContain('sludox_auth_');
      expect(challengeData.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should verify legitimate Ed25519 wallet signature', async () => {
      const keypair = Keypair.random();
      const wallet = keypair.publicKey();
      const { challenge } = service.generateChallenge(wallet);

      const sigBuffer = keypair.sign(Buffer.from(challenge, 'utf8'));
      const signatureBase64 = sigBuffer.toString('base64');

      const isValid = await service.verifyWalletSignature(
        wallet,
        signatureBase64,
        challenge,
      );
      expect(isValid).toBe(true);
    });

    it('should reject tampered challenge or invalid signature', async () => {
      const keypair = Keypair.random();
      const wallet = keypair.publicKey();
      const otherKeypair = Keypair.random();
      const { challenge } = service.generateChallenge(wallet);

      // Sign with wrong key
      const wrongSig = otherKeypair.sign(Buffer.from(challenge, 'utf8')).toString('base64');
      const isValid = await service.verifyWalletSignature(wallet, wrongSig, challenge);
      expect(isValid).toBe(false);
    });
  });

  describe('Ephemeral Session Key Generation & Delegation', () => {
    it('should create an ephemeral Ed25519 session key scoped to match', async () => {
      const wallet = Keypair.random().publicKey();
      const matchId = 'match-123';

      const session = await service.createSessionKey(wallet, matchId);
      expect(session.sessionPublicKey).toBeDefined();
      expect(session.sessionSecret).toBeDefined();
      expect(session.walletAddress).toBe(wallet);
      expect(session.matchId).toBe(matchId);
      expect(session.authorized).toBe(true);
      expect(session.expiresAt).toBeGreaterThan(Date.now());

      const isValid = await service.validateSessionKey(session.sessionPublicKey!, matchId);
      expect(isValid).toBe(true);
    });

    it('should reject session key for different match ID', async () => {
      const wallet = Keypair.random().publicKey();
      const session = await service.createSessionKey(wallet, 'match-1');

      const isValid = await service.validateSessionKey(session.sessionPublicKey!, 'match-2');
      expect(isValid).toBe(false);
    });

    it('should authorize client-provided session key with wallet signature', async () => {
      const walletKeypair = Keypair.random();
      const wallet = walletKeypair.publicKey();
      const sessionKeypair = Keypair.random();
      const sessionPublicKey = sessionKeypair.publicKey();
      const matchId = 'match-xyz';
      const delegationMessage = `Authorize ${sessionPublicKey} for ${matchId}`;

      const sig = walletKeypair.sign(Buffer.from(delegationMessage, 'utf8')).toString('base64');

      const success = await service.authorizeSessionKey(
        wallet,
        sessionPublicKey,
        matchId,
        sig,
        delegationMessage,
      );
      expect(success).toBe(true);

      const isValid = await service.validateSessionKey(sessionPublicKey, matchId);
      expect(isValid).toBe(true);
    });
  });

  describe('Session Micro-Move Packet Signing', () => {
    it('should verify in-game moves signed by ephemeral session key without wallet popups', async () => {
      const wallet = Keypair.random().publicKey();
      const matchId = 'match-play';
      const session = await service.createSessionKey(wallet, matchId);

      const sessionKp = Keypair.fromSecret(session.sessionSecret!);
      const movePacket = {
        action: 'move',
        matchId,
        tokenId: 0,
        diceValue: 6,
        timestamp: Date.now(),
      };

      const packetString = JSON.stringify(movePacket);
      const signature = sessionKp.sign(Buffer.from(packetString, 'utf8')).toString('base64');

      const verified = await service.verifySessionSignature(
        session.sessionPublicKey!,
        matchId,
        packetString,
        signature,
      );
      expect(verified).toBe(true);
    });

    it('should revoke session key on match conclusion', async () => {
      const wallet = Keypair.random().publicKey();
      const matchId = 'match-end';
      const session = await service.createSessionKey(wallet, matchId);

      await service.revokeSessionKey(session.sessionPublicKey!);
      const isValid = await service.validateSessionKey(session.sessionPublicKey!, matchId);
      expect(isValid).toBe(false);
    });
  });
});
