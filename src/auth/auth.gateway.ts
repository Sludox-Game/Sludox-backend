import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SOCKET_EVENTS } from '../common/constants';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/auth',
})
export class AuthGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AuthGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly authService: AuthService) {}

  async handleConnection(client: Socket): Promise<void> {
    this.logger.log(`Auth client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`Auth client disconnected: ${client.id}`);
  }

  /**
   * Handle wallet authentication via signed challenge.
   * Payload: { walletAddress, signature, challenge }
   */
  @SubscribeMessage('auth:wallet')
  async handleWalletAuth(
    client: Socket,
    payload: { walletAddress: string; signature: string; challenge: string },
  ): Promise<void> {
    try {
      const isValid = await this.authService.verifyWalletSignature(
        payload.walletAddress,
        payload.signature,
        payload.challenge,
      );

      if (!isValid) {
        client.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid signature' });
        return;
      }

      client.data.walletAddress = payload.walletAddress;
      client.emit('auth:success', { walletAddress: payload.walletAddress });
    } catch (error) {
      this.logger.error(`Auth error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Authentication failed' });
    }
  }

  /**
   * Request a challenge nonce for wallet authentication.
   * Payload: { walletAddress }
   */
  @SubscribeMessage('auth:challenge')
  async handleChallenge(
    client: Socket,
    payload: { walletAddress: string },
  ): Promise<void> {
    try {
      const challengeData = this.authService.generateChallenge(payload.walletAddress);
      client.emit('auth:challenge', challengeData);
    } catch (error) {
      this.logger.error(`Challenge generation error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Challenge generation failed' });
    }
  }

  /**
   * Handle session key generation after wallet auth.
   * Payload: { walletAddress, matchId }
   */
  @SubscribeMessage('auth:session-key')
  async handleSessionKey(
    client: Socket,
    payload: { walletAddress: string; matchId: string },
  ): Promise<void> {
    try {
      const sessionKey = await this.authService.createSessionKey(
        payload.walletAddress,
        payload.matchId,
      );
      client.emit('auth:session-key', sessionKey);
    } catch (error) {
      this.logger.error(`Session key error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, {
        message: 'Session key generation failed',
      });
    }
  }

  /**
   * Handle delegation of a client-side session key.
   * Payload: { walletAddress, sessionPublicKey, matchId, walletSignature, delegationMessage }
   */
  @SubscribeMessage('auth:delegate-session')
  async handleDelegateSession(
    client: Socket,
    payload: {
      walletAddress: string;
      sessionPublicKey: string;
      matchId: string;
      walletSignature: string;
      delegationMessage: string;
    },
  ): Promise<void> {
    try {
      const success = await this.authService.authorizeSessionKey(
        payload.walletAddress,
        payload.sessionPublicKey,
        payload.matchId,
        payload.walletSignature,
        payload.delegationMessage,
      );

      if (!success) {
        client.emit(SOCKET_EVENTS.ERROR, { message: 'Session delegation failed' });
        return;
      }

      client.emit('auth:session-delegated', {
        sessionPublicKey: payload.sessionPublicKey,
        matchId: payload.matchId,
      });
    } catch (error) {
      this.logger.error(`Session delegation error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Delegation failed' });
    }
  }

  /**
   * Verify an active session key.
   * Payload: { sessionKey, matchId }
   */
  @SubscribeMessage('auth:verify-session')
  async handleVerifySession(
    client: Socket,
    payload: { sessionKey: string; matchId: string },
  ): Promise<void> {
    try {
      const isValid = await this.authService.validateSessionKey(
        payload.sessionKey,
        payload.matchId,
      );
      client.emit('auth:session-verified', {
        sessionKey: payload.sessionKey,
        valid: isValid,
      });
    } catch (error) {
      this.logger.error(`Session verify error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Verification failed' });
    }
  }
}

