# Sludox Backend

Authoritative NestJS game engine for Sludox — a Web3-native multiplayer Ludo game on Stellar.

## Architecture

The backend follows a modular monorepo structure with four domain modules:

```
src/
├── main.ts                 # Entry point
├── app.module.ts           # Root module (DB, Redis, BullMQ)
├── common/                 # Shared constants, enums, interfaces
│   ├── constants.ts        # Game config, socket events, Redis keys
│   ├── enums.ts            # PlayerColor, MatchStatus, TokenState, etc.
│   └── interfaces.ts       # Match, Player, Token, DiceRoll, etc.
├── auth/                   # Wallet auth & session key management
│   ├── auth.module.ts
│   ├── auth.service.ts     # Signature verification, session key lifecycle
│   └── auth.gateway.ts     # WebSocket namespace: /auth
├── match/                  # Core game engine & matchmaking
│   ├── match.module.ts
│   ├── ludo-engine.service.ts    # Ludo rules, dice, captures, win detection
│   ├── matchmaking.service.ts    # Global queue & private lobbies
│   ├── ai-player.service.ts      # AI failover logic
│   ├── match.service.ts          # Orchestrates game actions
│   └── match.gateway.ts          # WebSocket namespace: /game
├── voice/                  # WebRTC signaling for P2P voice chat
│   ├── voice.module.ts
│   ├── voice.service.ts    # Peer registry
│   └── voice.gateway.ts    # WebSocket namespace: /voice
└── blockchain/             # Soroban bridge & async tx queue
    ├── blockchain.module.ts
    ├── blockchain.service.ts     # Contract interaction methods
    └── transaction.processor.ts  # BullMQ worker for on-chain ops
```

## Prerequisites

- Node.js 20+
- pnpm (recommended) or npm
- Docker (for PostgreSQL, Redis, Stellar Quickstart)

## Getting Started

### 1. Start infrastructure

```bash
docker compose -f ../docker-compose.yml up -d postgres redis
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env if needed
```

### 4. Start development server

```bash
pnpm start:dev
```

Server starts on http://localhost:3001

## WebSocket Namespaces

| Namespace | Purpose |
|-----------|---------|
| `/auth`   | Wallet authentication & session key exchange |
| `/game`   | Matchmaking, dice rolls, token moves, chat |
| `/voice`  | WebRTC signaling for P2P voice chat |

## Key Socket Events

### Client → Server
- `auth:wallet` — Authenticate with wallet signature
- `auth:session-key` — Request session key for a match
- `matchmaking:join` — Join global queue
- `matchmaking:leave` — Leave queue
- `match:join` — Join a match room
- `game:roll` — Roll dice
- `game:move` — Move a token
- `game:timeout` — Report turn timeout
- `chat:send` — Send chat message
- `voice:join` / `voice:leave` — Voice channel management
- `voice:offer` / `voice:answer` / `voice:ice-candidate` — WebRTC signaling

### Server → Client
- `match:started` — Match has begun
- `game:dice` — Dice roll result
- `game:token-moved` — Token position update
- `game:token-captured` — Capture event
- `game:turn` — Turn change notification
- `game:timer` — Turn countdown
- `game:ai-takeover` — AI has taken over a seat
- `match:ended` — Match result
- `chat:message` — Incoming chat

## Testing

```bash
pnpm test        # Unit tests
pnpm test:e2e    # E2E tests
pnpm test:cov    # Coverage report
```
