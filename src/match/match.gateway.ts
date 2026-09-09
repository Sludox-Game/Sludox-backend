import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Optional } from '@nestjs/common';
import { MatchService } from './match.service';
import { MatchmakingService } from './matchmaking.service';
import { AuthService } from '../auth/auth.service';
import { SOCKET_EVENTS } from '../common/constants';
import { MatchmakingEntry } from '../common/interfaces';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/game',
})
export class MatchGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MatchGateway.name);

  @WebSocketServer()
  server!: Server;

  /** Map of socketId → { userId, matchId } */
  private readonly socketMap = new Map<
    string,
    { userId: string; matchId?: string }
  >();

  constructor(
    private readonly matchService: MatchService,
    private readonly matchmakingService: MatchmakingService,
    @Optional()
    private readonly authService?: AuthService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    this.logger.log(`Game client connected: ${client.id}`);
    this.socketMap.set(client.id, { userId: client.id });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`Game client disconnected: ${client.id}`);
    const entry = this.socketMap.get(client.id);

    if (entry?.matchId) {
      const match = this.matchmakingService.getMatch(entry.matchId);
      if (match) {
        const player = match.players.find((p) => p.userId === entry.userId);
        if (player) {
          this.matchService.handleDisconnect(entry.matchId, player.color);
          client.to(entry.matchId).emit(SOCKET_EVENTS.PLAYER_DISCONNECTED, {
            playerColor: player.color,
          });
        }
      }
    }

    this.socketMap.delete(client.id);
  }

  /**
   * Join the global matchmaking queue with Elo rating.
   * Payload: { walletAddress, elo?: number, stake?: number }
   */
  @SubscribeMessage('matchmaking:join')
  async handleJoinQueue(
    client: Socket,
    payload: { walletAddress: string; elo?: number; stake?: number },
  ): Promise<void> {
    try {
      const entry: MatchmakingEntry = {
        userId: client.id,
        walletAddress: payload.walletAddress,
        stake: payload.stake ?? 0.2,
        joinedAt: Date.now(),
        elo: payload.elo ?? 1200,
      };

      const match = await this.matchmakingService.addToQueue(entry);

      if (match) {
        client.join(match.id);
        const mapEntry = this.socketMap.get(client.id);
        if (mapEntry) mapEntry.matchId = match.id;

        this.server.to(match.id).emit(SOCKET_EVENTS.MATCH_STARTED, { match });
      } else {
        client.emit('matchmaking:queued', {
          position: this.matchmakingService.getQueueSize(),
        });
      }
    } catch (error) {
      this.logger.error(`Matchmaking error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to join queue' });
    }
  }

  /**
   * Leave the matchmaking queue.
   */
  @SubscribeMessage('matchmaking:leave')
  async handleLeaveQueue(client: Socket): Promise<void> {
    await this.matchmakingService.removeFromQueue(client.id);
    client.emit('matchmaking:left');
  }

  /**
   * Join a specific match room.
   * Payload: { matchId }
   */
  @SubscribeMessage('match:join')
  async handleJoinMatch(
    client: Socket,
    payload: { matchId: string },
  ): Promise<void> {
    try {
      const match = this.matchmakingService.getMatch(payload.matchId);
      if (!match) {
        client.emit(SOCKET_EVENTS.ERROR, { message: 'Match not found' });
        return;
      }

      client.join(payload.matchId);
      const entry = this.socketMap.get(client.id);
      if (entry) {
        entry.matchId = payload.matchId;
      }

      client.emit(SOCKET_EVENTS.MATCH_STARTED, { match });
      client.to(payload.matchId).emit('player:joined', {
        userId: client.id,
      });
    } catch (error) {
      this.logger.error(`Join match error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to join match' });
    }
  }

  /**
   * Roll the dice, optionally verified with ephemeral session key signature.
   * Payload: { matchId, playerColor, sessionPublicKey?, signature? }
   */
  @SubscribeMessage('game:roll')
  async handleRollDice(
    client: Socket,
    payload: {
      matchId: string;
      playerColor: string;
      sessionPublicKey?: string;
      signature?: string;
    },
  ): Promise<void> {
    try {
      // If session key is provided, verify signature
      if (payload.sessionPublicKey && payload.signature && this.authService) {
        const verifyData = {
          action: 'roll',
          matchId: payload.matchId,
          playerColor: payload.playerColor,
        };
        const isValidSession = await this.authService.verifySessionSignature(
          payload.sessionPublicKey,
          payload.matchId,
          verifyData,
          payload.signature,
        );
        if (!isValidSession) {
          client.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid session signature' });
          return;
        }
      }

      const result = this.matchService.handleRollDice(
        payload.matchId,
        payload.playerColor,
      );

      if (!result) {
        client.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid roll' });
        return;
      }

      // Broadcast dice result to all players in the match
      this.server.to(payload.matchId).emit(SOCKET_EVENTS.DICE_RESULT, {
        playerColor: payload.playerColor,
        diceRoll: result.diceRoll,
      });

      // If roll had no valid moves, broadcast auto-advanced turn change
      if (result.autoTurnAdvanced) {
        this.server.to(payload.matchId).emit(SOCKET_EVENTS.TURN_CHANGED, {
          currentTurn: result.match.players[result.match.currentTurnIndex].color,
          turnDeadline: result.match.turnDeadline,
        });
      }
    } catch (error) {
      this.logger.error(`Roll dice error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to roll dice' });
    }
  }

  /**
   * Move a token, optionally verified with ephemeral session key signature.
   * Payload: { matchId, playerColor, tokenId, sessionPublicKey?, signature? }
   */
  @SubscribeMessage('game:move')
  async handleMoveToken(
    client: Socket,
    payload: {
      matchId: string;
      playerColor: string;
      tokenId: number;
      sessionPublicKey?: string;
      signature?: string;
    },
  ): Promise<void> {
    try {
      // If session key is provided, verify signature without wallet popup
      if (payload.sessionPublicKey && payload.signature && this.authService) {
        const verifyData = {
          action: 'move',
          matchId: payload.matchId,
          playerColor: payload.playerColor,
          tokenId: payload.tokenId,
        };
        const isValidSession = await this.authService.verifySessionSignature(
          payload.sessionPublicKey,
          payload.matchId,
          verifyData,
          payload.signature,
        );
        if (!isValidSession) {
          client.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid session signature' });
          return;
        }
      }

      const result = await this.matchService.handleMoveToken(
        payload.matchId,
        payload.playerColor,
        payload.tokenId,
      );

      if (!result) {
        client.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid move' });
        return;
      }

      // Broadcast token movement
      this.server.to(payload.matchId).emit(SOCKET_EVENTS.TOKEN_MOVED, {
        playerColor: payload.playerColor,
        tokenId: payload.tokenId,
        match: result.match,
      });

      // If capture occurred
      if (result.captured) {
        this.server.to(payload.matchId).emit(SOCKET_EVENTS.TOKEN_CAPTURED, {
          capturer: payload.playerColor,
          victim: result.captured.color,
        });
      }

      // If winner
      if (result.isWinner) {
        this.server.to(payload.matchId).emit(SOCKET_EVENTS.MATCH_ENDED, {
          winner: payload.playerColor,
          match: result.match,
        });
      } else {
        // Broadcast turn change
        this.server.to(payload.matchId).emit(SOCKET_EVENTS.TURN_CHANGED, {
          currentTurn: result.match.players[result.match.currentTurnIndex].color,
          turnDeadline: result.match.turnDeadline,
        });
      }
    } catch (error) {
      this.logger.error(`Move token error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to move token' });
    }
  }

  /**
   * Handle turn timeout.
   * Payload: { matchId, playerColor }
   */
  @SubscribeMessage('game:timeout')
  async handleTimeout(
    client: Socket,
    payload: { matchId: string; playerColor: string },
  ): Promise<void> {
    try {
      const match = this.matchService.handleTimeout(
        payload.matchId,
        payload.playerColor,
      );

      if (!match) {
        client.emit(SOCKET_EVENTS.ERROR, { message: 'Timeout handling failed' });
        return;
      }

      const player = match.players.find(
        (p) => p.color === payload.playerColor,
      );

      if (player?.seatType === 'ai') {
        this.server.to(payload.matchId).emit(SOCKET_EVENTS.AI_TAKEOVER, {
          playerColor: payload.playerColor,
        });
      }

      this.server.to(payload.matchId).emit(SOCKET_EVENTS.TURN_CHANGED, {
        currentTurn: match.players[match.currentTurnIndex].color,
        turnDeadline: match.turnDeadline,
      });
    } catch (error) {
      this.logger.error(`Timeout error: ${(error as Error).message}`);
      client.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to handle timeout' });
    }
  }

  /**
   * Send a chat message.
   * Payload: { matchId, message }
   */
  @SubscribeMessage('chat:send')
  async handleChat(
    client: Socket,
    payload: { matchId: string; message: string },
  ): Promise<void> {
    this.server.to(payload.matchId).emit(SOCKET_EVENTS.CHAT_MESSAGE, {
      userId: client.id,
      message: payload.message,
      timestamp: Date.now(),
    });
  }
}

