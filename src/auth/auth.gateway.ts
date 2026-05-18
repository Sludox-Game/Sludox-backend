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
}
