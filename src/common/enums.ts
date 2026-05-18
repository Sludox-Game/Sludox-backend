// ──────────────────────────────────────────────
// Sludox Shared Enums
// ──────────────────────────────────────────────

/** Player colors on the Ludo board */
export enum PlayerColor {
  RED = 'red',
  BLUE = 'blue',
  GREEN = 'green',
  YELLOW = 'yellow',
}

/** Match status lifecycle */
export enum MatchStatus {
  WAITING = 'waiting',
  STARTED = 'started',
  FINISHED = 'finished',
  CANCELLED = 'cancelled',
}

/** Seat state — human or AI */
export enum SeatType {
  HUMAN = 'human',
  AI = 'ai',
}

/** Token position state */
export enum TokenState {
  HOME = 'home',
  ACTIVE = 'active',
  FINISHED = 'finished',
}

/** Transaction types for the async queue */
export enum TransactionType {
  BUY_IN = 'buy_in',
  CAPTURE_PAYOUT = 'capture_payout',
  WINNER_PAYOUT = 'winner_payout',
  RAKE_COLLECTION = 'rake_collection',
  REBATE_DISTRIBUTION = 'rebate_distribution',
}

/** Transaction status */
export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}
