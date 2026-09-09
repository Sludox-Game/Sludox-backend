import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { MatchmakingEntry, Player, Match } from '../common/interfaces';
import { PlayerColor, SeatType, MatchStatus } from '../common/enums';
import {
  PLAYERS_PER_MATCH,
  BASE_BUY_IN_XLM,
  MATCHMAKING_TIMEOUT_MS,
  TURN_TIMEOUT_SECONDS,
} from '../common/constants';
import { LudoEngine } from './ludo-engine.service';

const BASE_ELO_TOLERANCE = 100;
const ELO_TOLERANCE_GROWTH_INTERVAL_MS = 5000;
const ELO_TOLERANCE_GROWTH_STEP = 50;

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  /** In-memory matchmaking queue */
  private queue: MatchmakingEntry[] = [];

  /** Active matches mapped by matchId */
  private matches: Map<string, Match> = new Map();

  constructor(private readonly ludoEngine: LudoEngine) {}

  /**
   * Calculate effective Elo tolerance for an entry based on time spent in queue.
   */
  calculateTolerance(entry: MatchmakingEntry, now = Date.now()): number {
    const elapsed = Math.max(0, now - entry.joinedAt);
    const growthCycles = Math.floor(
      elapsed / ELO_TOLERANCE_GROWTH_INTERVAL_MS,
    );
    return BASE_ELO_TOLERANCE + growthCycles * ELO_TOLERANCE_GROWTH_STEP;
  }

  /**
   * Determine if two queue entries are compatible based on stake and dynamic Elo tolerance.
   */
  areEntriesCompatible(
    a: MatchmakingEntry,
    b: MatchmakingEntry,
    now = Date.now(),
  ): boolean {
    if (Math.abs(a.stake - b.stake) > 0.001) return false;

    const eloA = a.elo ?? 1200;
    const eloB = b.elo ?? 1200;
    const diff = Math.abs(eloA - eloB);

    const tolA = this.calculateTolerance(a, now);
    const tolB = this.calculateTolerance(b, now);
    const maxTolerance = Math.max(tolA, tolB);

    return diff <= maxTolerance;
  }

  /**
   * Add a player to the matchmaking queue and attempt pairing.
   */
  async addToQueue(entry: MatchmakingEntry): Promise<Match | null> {
    // Prevent duplicate queue entries for same user
    this.queue = this.queue.filter((e) => e.userId !== entry.userId);

    const enrichedEntry: MatchmakingEntry = {
      ...entry,
      elo: entry.elo ?? 1200,
      joinedAt: entry.joinedAt || Date.now(),
      stake: entry.stake || BASE_BUY_IN_XLM,
    };

    this.queue.push(enrichedEntry);
    this.logger.log(
      `Player ${enrichedEntry.userId} (Elo: ${enrichedEntry.elo}) queued. Queue size: ${this.queue.length}`,
    );

    const matches = this.processQueue();
    const userMatch = matches.find((m) =>
      m.players.some((p) => p.userId === entry.userId),
    );
    return userMatch || null;
  }

  /**
   * Remove a player from the matchmaking queue.
   */
  async removeFromQueue(userId: string): Promise<void> {
    this.queue = this.queue.filter((e) => e.userId !== userId);
    this.logger.log(`Player ${userId} removed from queue. Size: ${this.queue.length}`);
  }

  /**
   * Match compatible players using dynamic Elo rating buckets.
   */
  processQueue(now = Date.now()): Match[] {
    const createdMatches: Match[] = [];

    // Sort by oldest joined first
    this.queue.sort((a, b) => a.joinedAt - b.joinedAt);

    let i = 0;
    while (i < this.queue.length) {
      const leader = this.queue[i];
      const matchedGroup: MatchmakingEntry[] = [leader];

      for (let j = 0; j < this.queue.length; j++) {
        if (i === j) continue;
        const candidate = this.queue[j];

        if (this.areEntriesCompatible(leader, candidate, now)) {
          matchedGroup.push(candidate);
          if (matchedGroup.length === PLAYERS_PER_MATCH) break;
        }
      }

      if (matchedGroup.length === PLAYERS_PER_MATCH) {
        // Remove matched players from queue
        const matchedIds = new Set(matchedGroup.map((e) => e.userId));
        this.queue = this.queue.filter((e) => !matchedIds.has(e.userId));

        const match = this.createMatchFromQueue(matchedGroup);
        createdMatches.push(match);
        i = 0; // Reset search from start
      } else {
        i++;
      }
    }

    return createdMatches;
  }

  /**
   * Check for players waiting >= 30s and spawn timeout AI bots to fill remainder.
   */
  checkTimeouts(now = Date.now()): Match[] {
    const timeoutMatches: Match[] = [];

    // Identify players exceeding timeout
    const timedOutEntries = this.queue.filter(
      (entry) => now - entry.joinedAt >= MATCHMAKING_TIMEOUT_MS,
    );

    for (const leader of timedOutEntries) {
      // Check if leader still in queue
      if (!this.queue.some((e) => e.userId === leader.userId)) continue;

      // Group any compatible humans waiting
      const group: MatchmakingEntry[] = [leader];
      for (const other of this.queue) {
        if (other.userId !== leader.userId && this.areEntriesCompatible(leader, other, now)) {
          group.push(other);
          if (group.length === PLAYERS_PER_MATCH) break;
        }
      }

      // Remove grouped humans from queue
      const groupedIds = new Set(group.map((e) => e.userId));
      this.queue = this.queue.filter((e) => !groupedIds.has(e.userId));

      // Fill remaining seats with intelligent AI bots
      const match = this.createMatchWithBots(group);
      timeoutMatches.push(match);
      this.logger.log(
        `Spawned match ${match.id} with ${group.length} humans and ${PLAYERS_PER_MATCH - group.length} AI bots after queue timeout`,
      );
    }

    return timeoutMatches;
  }

  /**
   * Create an active match from a full group of human entries.
   */
  private createMatchFromQueue(entries: MatchmakingEntry[]): Match {
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
    match.status = MatchStatus.STARTED;
    match.startedAt = Date.now();
    match.currentTurnIndex = 0;
    match.turnDeadline = Date.now() + TURN_TIMEOUT_SECONDS * 1000;

    this.matches.set(matchId, match);
    this.logger.log(
      `Elo-matched room ${matchId} created with ${players.length} human players`,
    );
    return match;
  }

  /**
   * Create an active match with humans and intelligent AI bots to fill empty seats.
   */
  createMatchWithBots(humanEntries: MatchmakingEntry[]): Match {
    const colors = Object.values(PlayerColor);
    const matchId = uuidv4();
    const players: Player[] = [];

    // Add humans
    humanEntries.slice(0, PLAYERS_PER_MATCH).forEach((entry, idx) => {
      players.push({
        userId: entry.userId,
        walletAddress: entry.walletAddress,
        color: colors[idx],
        seatType: SeatType.HUMAN,
        tokens: this.ludoEngine.createTokens(),
        timeoutStrikes: 0,
        isConnected: true,
      });
    });

    // Add AI bots for remainder
    for (let i = players.length; i < PLAYERS_PER_MATCH; i++) {
      const botColor = colors[i];
      players.push({
        userId: `ai_bot_${botColor}_${matchId.slice(0, 6)}`,
        walletAddress: `GBOT_${botColor.toUpperCase()}_${matchId.slice(0, 6)}`,
        color: botColor,
        seatType: SeatType.AI,
        tokens: this.ludoEngine.createTokens(),
        timeoutStrikes: 0,
        isConnected: true,
      });
    }

    const match = this.ludoEngine.createMatch(matchId, players);
    match.status = MatchStatus.STARTED;
    match.startedAt = Date.now();
    match.currentTurnIndex = 0;
    match.turnDeadline = Date.now() + TURN_TIMEOUT_SECONDS * 1000;

    this.matches.set(matchId, match);
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
   * Get raw queue array (for diagnostics / inspection).
   */
  getQueue(): MatchmakingEntry[] {
    return [...this.queue];
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
      match.turnDeadline = Date.now() + TURN_TIMEOUT_SECONDS * 1000;
    }

    this.matches.set(matchId, match);
    return match;
  }
}

