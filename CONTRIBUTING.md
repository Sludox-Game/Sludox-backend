# Contributing to Sludox

First off, thanks for your interest! Sludox is an open-source Web3 Ludo game built on Stellar/Soroban, and we welcome contributions of all kinds — bug fixes, features, documentation, or just ideas.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Project Overview](#project-overview)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Git & PR Process](#git--pr-process)
- [Issue Labels](#issue-labels)
- [Architecture Overview](#architecture-overview)
- [Need Help?](#need-help)

## Code of Conduct

This project follows a **be excellent to each other** policy. Harassment, personal attacks, and gatekeeping are not welcome. We're here to learn and build together.

## Project Overview

Sludox is a **full-stack Web3 Ludo game** with three major components:

| Component | Stack | Location |
|-----------|-------|----------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS v4 | `frontend/` |
| **Backend** | NestJS 10, TypeScript, Socket.io, BullMQ | `backend/` |
| **Smart Contracts** | Rust (Soroban SDK v21), `no_std` | `contracts/` |


## Getting Started

### Prerequisites

- **Node.js 20+** — with pnpm (or npm)
- **Docker + Docker Compose** — PostgreSQL, Redis, optional Stellar
- **Rust** — with `wasm32-unknown-unknown` target (for contracts)
- **Soroban CLI** — for contract deployment

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

This starts PostgreSQL (port 5432) and Redis (port 6379). Optionally, uncomment the `stellar` service in `docker-compose.yml` for a local Stellar testnet.

### 3. Configure the backend

```bash
cd backend
cp .env.example .env
# Edit .env if your local setup differs
```

### 4. Start the backend

## Development Workflow

### Branch naming

```
feature/short-description    — New features
fix/short-description        — Bug fixes
docs/short-description       — Documentation changes
refactor/short-description   — Code improvements without new features
```

### Commit messages

Use conventional commits:

```
feat: add commit-reveal dice rolling
fix: correct turn advance after capture
docs: update README with new contract functions
refactor: extract move validation into helper
test: add AI failover edge case tests
```

### Before you submit

1. Run contract tests: `cd contracts && cargo test`
2. Run backend tests: `cd backend && npm test`
## Coding Standards

### Rust / Soroban

- Follow [Soroban documentation](https://soroban.stellar.org/docs) patterns
- Use `#![no_std]` — no standard library in contracts
- Annotate all types with `#[contracttype]`
- Use `Result<_, ContractError>` for all fallible functions
- Mark storage keys with `DataKey` enum variants
- Test with `testutils::Address as _` and `Env::default()`
- Document all public functions with `///` doc comments
- Use stroops (1 XLM = 10,000,000 stroops) for on-chain amounts

### TypeScript / NestJS

- Use NestJS module structure (module → service/gateway)
- Prefer `@Injectable()` services for business logic
- Use WebSocket gateways for real-time communication
- Keep shared types in `common/interfaces.ts`
- Use `ConfigService` for environment variables

### TypeScript / React
## Git & PR Process

1. **Fork the repo** and create your branch from `main`.
2. **Make your changes** following the coding standards above.
3. **Run tests** to ensure nothing is broken.
4. **Open a Pull Request** against the `main` branch.
5. **Describe your changes** clearly in the PR description.
6. **Link related issues** (e.g., "Closes #42").
7. **Wait for review** — at least one maintainer will review.

### PR checklist

- [ ] Code follows the project's coding standards
- [ ] New functions have corresponding tests
- [ ] All existing tests pass
- [ ] Documentation is updated (README, docs, or inline)
- [ ] PR title follows conventional commits

## Issue Labels

| Label | Description |
|-------|-------------|
| `good first issue` | Beginner-friendly; limited scope |
| `bug` | Something isn't working as expected |
| `enhancement` | New feature or improvement |
| `documentation` | Docs, README, inline comments |
| `contracts` | Soroban smart contract changes |
| `backend` | NestJS server changes |
## Architecture Overview

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
                                    │  (Escrow, Payouts,│
                                    │   Dice, Moves,    │
                                    │   AI Failover)    │
                                    └──────────────────┘
```

### Smart Contract vs Off-Chain Responsibilities

| Concern | Where | Why |
|---------|-------|-----|
| Match escrow (buy-ins) | Soroban | Financial settlement must be on-chain |
| Capture payouts | Soroban | Real XLM transfers between players |
| Winner distribution | Soroban | Platform rake + winner payout |
| Dice roll randomness | Soroban (commit-reveal) | Prevent server-side manipulation |
| Move legality validation | Soroban | Enforce game rules on-chain |
| AI failover & timeout | Soroban | Stake preservation, trustless |
| UI state & animations | Frontend (React) | Responsiveness, user experience |
| Real-time turn coordination | NestJS (WebSocket) | Sub-second latency required |
| Session key management | NestJS + Soroban | Ephemeral keys authorized on-chain |
| Voice chat signaling | NestJS (WebRTC) | P2P audio, server only does SDP/ICE |

## Need Help?

- Open a GitHub Discussion for questions
- File an Issue for bugs or feature requests
- Check the `docs/` directory for project briefs and architecture documents

---

<p align="center">
  <sub>Built by people who miss playing board games with friends.</sub>
</p>

| `frontend` | React UI changes |
| `blockchain` | Stellar integration, wallet, Soroban bridge |
| `help wanted` | Maintainers would especially appreciate help |


- Use functional components with hooks
- Store shared state in React Context (WalletContext, GameContext)
- Use the `src/app/components/ui/` shadcn-style primitives
- Keep page components in `src/app/pages/`
- Use TypeScript strict mode

## Testing Guidelines

### Smart Contracts (Rust)

```bash
cd contracts && cargo test
```

- Every new contract function must have tests
- Use the `setup_match_with_state()` helper for tests needing a full match
- Test both success and failure paths

### Backend (TypeScript/Jest)

```bash
cd backend && npm test
```

- Unit tests for services (Ludo engine, AI player, matchmaking)
- Use `@nestjs/testing` `Test.createTestingModule()`
- Mock external dependencies (BullMQ, TypeORM, Redis)

3. Ensure frontend builds: `cd frontend && npm run build`
4. Format your code:
   - **Rust**: `cargo fmt`
   - **TypeScript**: Prettier

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

### 6. Build and test contracts (optional)

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
cargo test
```

### How it works (the 30‑second version)

1. Four players buy in (0.2 XLM each) via the Soroban contract.
2. The game loop runs off-chain on NestJS for speed (sub-second moves, 15-second turn timers).
3. All financial events (capture payouts, winner settlements) are anchored on-chain.
4. If a player disconnects, a timeout system on the contract marks them AI-controlled after 2 strikes.
5. Session keys allow gasless mid-game moves.
