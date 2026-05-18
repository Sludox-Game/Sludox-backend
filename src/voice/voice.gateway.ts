import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { VoiceService } from './voice.service';
import { SOCKET_EVENTS } from '../common/constants';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/voice',
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly voiceService: VoiceService) {}

  async handleConnection(client: Socket): Promise<void> {
    this.logger.log(`Voice client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`Voice client disconnected: ${client.id}`);
    // Clean up peer connections
    const matchId = client.data.matchId;
    if (matchId) {
      this.voiceService.removePeer(matchId, client.id);
    }
  }

  /**
   * Join a voice channel for a match.
   * Payload: { matchId }
   */
  @SubscribeMessage('voice:join')
  async handleJoinVoice(
    client: Socket,
    payload: { matchId: string },
  ): Promise<void> {
    try {
      client.join(`voice:${payload.matchId}`);
      client.data.matchId = payload.matchId;
      this.voiceService.registerPeer(payload.matchId, client.id);

      // Notify other peers in the match
      const peers = this.voiceService.getPeersInMatch(
        payload.matchId,
        client.id,
      );
      client.emit('voice:peers', { peers });
      client
        .to(`voice:${payload.matchId}`)
        .emit('voice:peer-joined', { peerId: client.id });
    } catch (error) {
      this.logger.error(`Voice join error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to join voice' });
    }
  }

  /**
   * Relay WebRTC offer to a specific peer.
   * Payload: { to: peerId, sdp: any }
   */
  @SubscribeMessage('voice:offer')
  async handleOffer(
    client: Socket,
    payload: { to: string; sdp: any },
  ): Promise<void> {
    this.server.to(payload.to).emit(SOCKET_EVENTS.VOICE_OFFER, {
      from: client.id,
      sdp: payload.sdp,
    });
  }

  /**
   * Relay WebRTC answer to a specific peer.
   * Payload: { to: peerId, sdp: any }
   */
  @SubscribeMessage('voice:answer')
  async handleAnswer(
    client: Socket,
    payload: { to: string; sdp: any },
  ): Promise<void> {
    this.server.to(payload.to).emit(SOCKET_EVENTS.VOICE_ANSWER, {
      from: client.id,
      sdp: payload.sdp,
    });
  }

  /**
   * Relay ICE candidate to a specific peer.
   * Payload: { to: peerId, candidate: any }
   */
  @SubscribeMessage('voice:ice-candidate')
  async handleIceCandidate(
    client: Socket,
    payload: { to: string; candidate: any },
  ): Promise<void> {
    this.server.to(payload.to).emit(SOCKET_EVENTS.VOICE_ICE_CANDIDATE, {
      from: client.id,
      candidate: payload.candidate,
    });
  }

  /**
   * Leave a voice channel.
   * Payload: { matchId }
   */
  @SubscribeMessage('voice:leave')
  async handleLeaveVoice(
    client: Socket,
    payload: { matchId: string },
  ): Promise<void> {
    client.leave(`voice:${payload.matchId}`);
    this.voiceService.removePeer(payload.matchId, client.id);
    client
      .to(`voice:${payload.matchId}`)
      .emit('voice:peer-left', { peerId: client.id });
  }
}
