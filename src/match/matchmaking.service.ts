import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { MatchmakingEntry, Player, Match } from '../common/interfaces';
import { PlayerColor, SeatType, MatchStatus } from '../common/enums';
import { PLAYERS_PER_MATCH, BASE_BUY_IN_XLM } from '../common/constants';
import { LudoEngine } from './ludo-engine.service';

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  /** In-memory matchmaking queue (will be replaced with Redis) */
  private queue: MatchmakingEntry[] = [];

  /** Active matches */
  private matches: Map<string, Match> = new Map();

  constructor(private readonly ludoEngine: LudoEngine) {}

  /**
   * Add a player to the global matchmaking queue.
   */
  async addToQueue(entry: MatchmakingEntry): Promise<void> {
    this.queue.push(entry);
    this.logger.log(
      `Player ${entry.userId} added to queue. Queue size: ${this.queue.length}`,
    );

    // Check if we have enough players to start a match
    if (this.queue.length >= PLAYERS_PER_MATCH) {
      await this.createMatchFromQueue();
    }
  }

  /**
   * Remove a player from the matchmaking queue.
   */
  async removeFromQueue(userId: string): Promise<void> {
    this.queue = this.queue.filter((e) => e.userId !== userId);
  }

  /**
   * Create a match from queued players.
   */
  private async createMatchFromQueue(): Promise<Match> {
    const entries = this.queue.splice(0, PLAYERS_PER_MATCH);
    const colors = Object.values(PlayerColor);
    const matchId = uuidv4();

    const players: Player[] = entries.map((entry, index) => ({
      userId: entry.userId,
      walletAddress: entry.walletAddress,
      color: colors[index],
      seatType: SeatType.HUMAN,
      tokens: this.ludoEngine.createTokens(),
      timeoutStrikes: 0,
      isConnected: true,
    }));

    const match = this.ludoEngine.createMatch(matchId, players);
    this.matches.set(matchId, match);

    this.logger.log(`Match ${matchId} created with ${players.length} players`);
    return match;
  }

  /**
   * Get a match by ID.
   */
  getMatch(matchId: string): Match | undefined {
    return this.matches.get(matchId);
  }

  /**
   * Update a match in the store.
   */
  updateMatch(matchId: string, match: Match): void {
    this.matches.set(matchId, match);
  }

  /**
   * Get the current queue size.
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Create a private lobby and return the match ID.
   */
  async createPrivateLobby(
    hostEntry: MatchmakingEntry,
  ): Promise<{ matchId: string; shareableLink: string }> {
    const matchId = uuidv4();
    const color = PlayerColor.RED;

    const players: Player[] = [
      {
        userId: hostEntry.userId,
        walletAddress: hostEntry.walletAddress,
        color,
        seatType: SeatType.HUMAN,
        tokens: this.ludoEngine.createTokens(),
        timeoutStrikes: 0,
        isConnected: true,
      },
    ];

    const match = this.ludoEngine.createMatch(matchId, players);
    match.status = MatchStatus.WAITING;
    this.matches.set(matchId, match);

    const shareableLink = `sludox://lobby/${matchId}`;

    this.logger.log(`Private lobby ${matchId} created by ${hostEntry.userId}`);
    return { matchId, shareableLink };
  }

  /**
   * Join a private lobby by match ID.
   */
  async joinPrivateLobby(
    matchId: string,
    entry: MatchmakingEntry,
  ): Promise<Match | null> {
    const match = this.matches.get(matchId);
    if (!match || match.status !== MatchStatus.WAITING) return null;

    const usedColors = match.players.map((p) => p.color);
    const availableColor = Object.values(PlayerColor).find(
      (c) => !usedColors.includes(c),
    );
    if (!availableColor) return null;

    const player: Player = {
      userId: entry.userId,
      walletAddress: entry.walletAddress,
      color: availableColor,
      seatType: SeatType.HUMAN,
      tokens: this.ludoEngine.createTokens(),
      timeoutStrikes: 0,
      isConnected: true,
    };

    match.players.push(player);

    // Start match if full
    if (match.players.length >= PLAYERS_PER_MATCH) {
      match.status = MatchStatus.STARTED;
      match.startedAt = Date.now();
      match.currentTurnIndex = 0;
    }

    this.matches.set(matchId, match);
    return match;
  }
}
