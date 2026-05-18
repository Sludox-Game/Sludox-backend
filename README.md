
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://placehold.co/600x200/1a1a2e/e0aaff?text=SLUDOX&font=montserrat">
    <img alt="Sludox" src="https://placehold.co/600x200/1a1a2e/e0aaff?text=SLUDOX&font=montserrat" width="600">
  </picture>
</p>

<p align="center">
  <b>Web3-native multiplayer Ludo — micro-stakes, real-time, on Stellar.</b>
</p>

<p align="center">
  <a href="#-overview">Overview</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-project-structure">Structure</a> •
  <a href="#-economic-model">Economics</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

---

## 🎲 Overview

Sludox is a multiplayer Ludo game that runs on the Stellar blockchain. The idea is simple: take a game everyone already knows how to play, add micro-stakes (0.2 XLM buy-ins), and remove the friction that usually kills Web3 gaming — no constant wallet pop-ups, no waiting for confirmations mid-match.

The core loop works like this: four players buy in, roll dice, move tokens around the board, and capture each other's pieces for real-time payouts. If someone disconnects, an AI takes over so the game doesn't stall. Losers earn tickets into a daily rebate pool — a small consolation that keeps people coming back.

This repo contains the full stack: a React frontend, a NestJS authoritative game server, and a Soroban smart contract for on-chain settlement.

---

## 🏗 Architecture

The system uses a hybrid state model. The game loop runs off-chain on a NestJS server for speed (sub-second moves, 15-second turn timers), while financial events — buy-ins, capture payouts, winner settlements — are anchored on the Stellar blockchain via Soroban smart contracts.

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│  Game Client │ ◄──────────────► │  NestJS Gateway   │
│  (React/Vite)│                   │  (Auth, Match,    │
│              │                   │   Voice Signaling) │
└──────┬──────┘                   └────────┬─────────┘
       │                                   │
       │  P2P WebRTC (Voice)               │ Redis (timers, queue)
       │                                   │
       ▼                                   ▼
┌─────────────┐                   ┌──────────────────┐
│ Other Players│                  │   BullMQ Worker   │
│ (Mesh Audio) │                  │  (Async Tx Queue) │
└─────────────┘                   └────────┬─────────┘
                                           │
                                           ▼
                                    ┌──────────────────┐
                                    │  Soroban Contract │
                                    │  (Escrow, Payouts)│
                                    └──────────────────┘
```

**Key decisions that shaped the architecture:**

- **Decentralized game logic with Soroban** — Dice roll validation uses on-chain commit-reveal to prevent server-side manipulation. Move legality (can a token move from position X with dice value Y?) is enforced by the smart contract, not the NestJS server. The server only coordinates real-time state; all financial settlements and critical game rules are enforced by the contract.
- **Session keys** — Players sign once per match. The server uses an ephemeral key to sign moves, so there's no wallet pop-up on every dice roll. The key expires after 60 minutes.
- **On-chain AI failover** — If a player times out twice (2 strikes), the smart contract marks them as AI-controlled. Their stake stays in the pot. The AI move is then executed by the contract against predefined rules (whitelist-based legal moves), not by a central server.
- **P2P voice chat** — Audio routes directly between players via WebRTC. The server only handles signaling (SDP/ICE exchange), so there's no cost for voice infrastructure.
- **Async settlement** — Capture payouts (0.05 XLM) are triggered by the server but processed through a BullMQ queue. The game UI doesn't wait for ledger confirmation.

### Smart Contract Responsibilities

The Soroban contract at `contracts/` handles:

| Contract Function | Purpose |
|---|---|
| `initialize_match` | Create match, escrow buy-ins from all 4 players |
| `execute_capture` | Mid-game capture payout (0.05 XLM deducted from victim, added to capturer) |
| `distribute_winnings` | End-game winner payout with 5% platform rake deduction |
| `commit_dice_roll` / `reveal_dice_roll` | Commit-reveal randomness for dice rolls (prevents server cheating) |
| `validate_move` | Verify a token move is legal (HOME needs 6, board moves match dice value, no overshoot) |
| `initialize_game_state` | Set up on-chain turn order, deadline, strikes tracking |
| `advance_turn` | Rotate to next eligible player |
| `report_inactivity` | Prove a player missed their deadline; after 2 strikes, mark AI-controlled |
| `execute_ai_move` | Execute a move on behalf of an AI-controlled player (stake preserved) |
| `issue_loss_tickets` / `get_loss_tickets` | Loss ticket issuance and query |
| `authorize_session_key` / `verify_session_key` | Ephemeral key authorization for gasless mid-game moves |

---

## 🧱 Tech Stack

| Layer | What we used | Why |
|---|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS v4 | Fast dev loop, mobile-first, no bloat |
| **Backend** | NestJS 10, TypeScript, Socket.io | Modular, opinionated, great for real-time state |
| **Smart Contracts** | Rust (Soroban SDK v21) | Stellar-native, low fees, deterministic |
| **Voice** | WebRTC (native P2P) | Zero server cost for audio |
| **Cache** | Redis 7 | Turn timers, matchmaking queue |
| **Database** | PostgreSQL 16 | Match history, loss tickets, auditing |
| **Queue** | BullMQ | Async transaction processing |
| **Infra** | Docker Compose | Local dev parity with production |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- pnpm (or npm)
- Docker + Docker Compose
- Rust with `wasm32-unknown-unknown` target (for contracts)
- Soroban CLI (for contract deployment)

### 1. Clone and install

```bash
git clone https://github.com/your-username/sludox.git
cd sludox

# Frontend
cd frontend && npm install && cd ..

# Backend
cd backend && npm install && cd ..
```

### 2. Start infrastructure

```bash
docker compose up -d postgres redis
```

This spins up PostgreSQL (port 5432) and Redis (port 6379). If you need the Stellar testnet node locally, uncomment the `stellar` service in `docker-compose.yml`.

### 3. Configure the backend

```bash
cd backend
cp .env.example .env
# Edit .env if your local setup differs
```

### 4. Start the backend

```bash
cd backend
pnpm start:dev
```

The NestJS server starts on `http://localhost:3001`.

### 5. Start the frontend

```bash
cd frontend
npm run dev
```

The Vite dev server starts on `http://localhost:5173`.

### 6. Build and deploy contracts (optional)

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
cargo test
```

---

## 📁 Project Structure

```
sludox/
├── frontend/                  # React game client
│   └── src/
│       ├── app/
│       │   ├── contexts/      # WalletContext, GameContext
│       │   ├── pages/         # Home, Matchmaking, Lobby, Game, 404
│       │   ├── components/    # Board, Dice, PlayerCard, etc.
│       │   └── routes.tsx
│       └── styles/
│
├── backend/                   # NestJS authoritative server
│   └── src/
│       ├── auth/              # Wallet auth, session key lifecycle
│       ├── match/             # Ludo engine, matchmaking, AI failover
│       ├── voice/             # WebRTC signaling
│       ├── blockchain/        # Soroban bridge, BullMQ tx processor
│       └── common/            # Shared types, enums, constants
│
├── contracts/                 # Soroban Rust smart contracts
│   └── src/
│       ├── lib.rs             # Contract entry points
│       ├── types.rs           # Shared types
│       └── tests.rs           # Contract tests
│
├── docs/                      # Project docs (PRD, architecture, brief)
└── docker-compose.yml         # PostgreSQL, Redis, Stellar
```

---

## 💰 Economic Model

| Metric | Value |
|---|---|
| Individual buy-in | 0.2 XLM |
| Total table pot | 0.8 XLM (4 players) |
| Platform rake | 5% (0.04 XLM) → Daily Loss Pool |
| Capture reward | 0.05 XLM per token captured |
| Winner payout | Remaining pot balance |

The rake funds a daily rebate pool. Defeated players earn "Loss Tickets" proportional to how many tokens they lost, giving them a shot at winning back some XLM each day. It's a small thing, but it makes losing sting a lot less.

---

## 🔌 WebSocket Events

### Client → Server

| Event | Description |
|---|---|
| `auth:wallet` | Authenticate with wallet signature |
| `auth:session-key` | Request session key for a match |
| `matchmaking:join` | Join global queue |
| `matchmaking:leave` | Leave queue |
| `match:join` | Join a match room |
| `game:roll` | Roll dice |
| `game:move` | Move a token |
| `game:timeout` | Report turn timeout |
| `voice:offer` / `voice:answer` / `voice:ice-candidate` | WebRTC signaling |

### Server → Client

| Event | Description |
|---|---|
| `match:started` | Match has begun |
| `game:dice` | Dice roll result |
| `game:token-moved` | Token position update |
| `game:token-captured` | Capture event with payout |
| `game:turn` | Turn change notification |
| `game:timer` | Turn countdown (15s) |
| `game:ai-takeover` | AI has taken over a seat |
| `match:ended` | Match result with payouts |

---

## 🧪 Current Status

### Frontend (~70%)
All major screens are built (landing, matchmaking, lobby, game board) with mock data powering the interactions. The UI uses shadcn-style components with Tailwind CSS v4.

### Backend (~60%)
Full NestJS module scaffolding with game engine, matchmaking, AI logic implemented. The Ludo engine handles dice rolling, token movement, capture detection, and win conditions.

### Smart Contracts (~85%)
The Soroban contract covers:
- ✅ Match escrow and buy-in management
- ✅ Capture payouts and winner distribution
- ✅ Loss tickets and platform rake
- ✅ Session key authorization
- ✅ **Dice commit-reveal** (on-chain randomness)
- ✅ **Move validation** (legality enforcement on-chain)
- ✅ **Game state tracking** (turn order, deadlines)
- ✅ **AI failover escrow** (timeout strikes, stake preservation)
- ✅ 16 unit tests covering all functions

### What's left
- Connect frontend to real WebSocket backend
- Wire up actual Stellar wallet integration (Freighter, Albedo)
- Deploy and integrate Soroban contracts with the backend
- Full game logic with collision detection and win conditions
- Voice chat integration
- Sound effects, victory animations, polish

## 🗺 Roadmap

### Milestone 1: Core On-Chain Settlement ✓
- [x] Soroban contract for match escrow, capture payouts, winner distribution
- [x] Loss tickets and platform rake
- [x] Session key management
- [x] Backend scaffolding with NestJS modules

### Milestone 2: Decentralized Game Logic ✓
- [x] Commit-reveal dice roll validation on-chain
- [x] Move legality enforcement in contract
- [x] On-chain game state (turn order, deadlines)
- [x] Smart contract AI failover with timeout strikes
- [x] Comprehensive contract test suite
- [ ] Deploy contract to Stellar testnet

### Milestone 3: Wallet Integration & Real Data
- [ ] Integrate Freighter wallet (Stellar browser extension)
- [ ] Integrate Albedo wallet (web-based Stellar wallet)
- [ ] Wire up frontend to real WebSocket backend
- [ ] Replace mock data with live game state
- [ ] End-to-end match flow on testnet

### Milestone 4: Full Game & Voice
- [ ] Collision detection and safe zones
- [ ] Win condition checks and animation
- [ ] P2P WebRTC voice chat integration
- [ ] Sound effects and victory animations
- [ ] Mobile-responsive polish

### Milestone 5: Production & Community
- [ ] Mainnet deployment
- [ ] Daily rebate pool automation
- [ ] Analytics dashboard (match history, leaderboards)
- [ ] Community governance for rake and parameters
- [ ] Bug bounty program

---

## 🤝 Contributing

We welcome contributions of all kinds! See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide covering:

- Setting up a local development environment
- Coding standards (Rust/Soroban, TypeScript/NestJS, React)
- Testing guidelines
- Git workflow and PR process
- Issue labels and where to start

**Quick links for new contributors:**
- Look for issues labeled [`good first issue`](https://github.com/your-username/sludox/labels/good%20first%20issue)
- Check [`docs/`](./docs/) for project briefs and architecture documents
- Open a Discussion for questions or ideas

---

## 📄 License

MIT — do what you want with it.

---

<p align="center">
  <sub>Built by people who miss playing board games with friends.</sub>
</p>
