// ──────────────────────────────────────────────
// Sludox Shared Interfaces
// ──────────────────────────────────────────────

import { PlayerColor, MatchStatus, SeatType, TokenState } from './enums';

/** A player in a match */
export interface Player {
  userId: string;
  walletAddress: string;
  color: PlayerColor;
  seatType: SeatType;
  tokens: Token[];
  timeoutStrikes: number;
  isConnected: boolean;
}

/** A single token on the board */
export interface Token {
  id: number;
  state: TokenState;
  position: number; // -1 = home, 0-51 = board, 52-56 = home column, 57 = goal
  stepCount?: number; // steps traveled: 0 in home, 1 at start, up to 57 at goal
}

/** A dice roll result */
export interface DiceRoll {
  value: number; // 1-6
  isDouble: boolean;
}

/** A match room */
export interface Match {
  id: string;
  status: MatchStatus;
  players: Player[];
  currentTurnIndex: number;
  turnOrder: PlayerColor[];
  turnDeadline: number | null; // Unix timestamp
  startedAt: number | null;
  finishedAt: number | null;
  winner: PlayerColor | null;
  currentDiceRoll?: DiceRoll | null;
  hasRolled?: boolean;
}

/** Matchmaking queue entry */
export interface MatchmakingEntry {
  userId: string;
  walletAddress: string;
  stake: number; // XLM amount
  joinedAt: number;
  elo?: number; // Skill rating (default 1200)
}

/** Session key payload */
export interface SessionKeyPayload {
  sessionKey: string;
  sessionPublicKey?: string;
  sessionSecret?: string;
  walletAddress: string;
  matchId: string;
  expiresAt: number;
  authorized?: boolean;
}


/** Transaction queue job data */
export interface TransactionJobData {
  type: string;
  matchId: string;
  fromWallet?: string;
  toWallet?: string;
  amount: string; // Stellar uses string for amounts
  signature?: string;
}

/** WebRTC signaling payload */
export interface SignalingPayload {
  type: 'offer' | 'answer' | 'ice-candidate';
  from: string;
  to: string;
  data: any;
}
