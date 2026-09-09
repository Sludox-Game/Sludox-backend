// ──────────────────────────────────────────────
// Sludox Game Constants
// ──────────────────────────────────────────────

/** Number of players per match */
export const PLAYERS_PER_MATCH = 4;

/** Tokens per player */
export const TOKENS_PER_PLAYER = 4;

/** Total squares on the Ludo board */
export const BOARD_SIZE = 52;

/** Base buy-in amount in XLM */
export const BASE_BUY_IN_XLM = 0.2;

/** Capture reward in XLM */
export const CAPTURE_REWARD_XLM = 0.05;

/** Platform rake percentage */
export const PLATFORM_RAKE_PERCENT = 5;

/** Turn timeout in seconds */
export const TURN_TIMEOUT_SECONDS = 15;

/** Max timeout strikes before AI takeover */
export const MAX_TIMEOUT_STRIKES = 2;

/** Session key expiry in minutes */
export const SESSION_KEY_EXPIRY_MINUTES = 60;

/** Safe squares on the board (cannot be captured here) */
export const SAFE_SQUARES: readonly number[] = [0, 8, 13, 21, 26, 34, 39, 47];

/** Starting position for finish column / home stretch */
export const HOME_STRETCH_START = 52;

/** Final destination square (Goal) */
export const GOAL_POSITION = 57;

/** Matchmaking queue timeout before spawning AI bots (30 seconds) */
export const MATCHMAKING_TIMEOUT_MS = 30_000;

/** BullMQ queue names */
export const QUEUES = {
  TRANSACTION: 'transaction-queue',
  REBATE: 'rebate-queue',
} as const;

/** Redis key prefixes */
export const REDIS_KEYS = {
  MATCH: 'match:',
  TURN_TIMER: 'turn:timer:',
  MATCHMAKING_QUEUE: 'matchmaking:queue',
  SESSION: 'session:',
  LEADERBOARD: 'leaderboard:',
} as const;

/** Socket event names */
export const SOCKET_EVENTS = {
  // Client → Server
  JOIN_MATCH: 'match:join',
  ROLL_DICE: 'game:roll',
  MOVE_TOKEN: 'game:move',
  SEND_CHAT: 'chat:send',
  VOICE_OFFER: 'voice:offer',
  VOICE_ANSWER: 'voice:answer',
  VOICE_ICE_CANDIDATE: 'voice:ice-candidate',

  // Server → Client
  MATCH_STARTED: 'match:started',
  DICE_RESULT: 'game:dice',
  TOKEN_MOVED: 'game:token-moved',
  TOKEN_CAPTURED: 'game:token-captured',
  TURN_CHANGED: 'game:turn',
  TURN_TIMER: 'game:timer',
  PLAYER_DISCONNECTED: 'player:disconnected',
  AI_TAKEOVER: 'game:ai-takeover',
  MATCH_ENDED: 'match:ended',
  CHAT_MESSAGE: 'chat:message',
  ERROR: 'error',
} as const;

