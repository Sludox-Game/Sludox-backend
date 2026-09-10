# Sludox-backend — Minor Issues Backlog (9 Issues)

Sized strictly as **100 pts (Trivial / Good First Issue)** in Drips Wave criteria.

---

## #1: Add Swagger tags and WebSocket event documentation for game matchmaking engine

- **Labels**: `complexity:trivial, backend, documentation, good first issue`

- **Complexity**: `100 pts` (Trivial)


### Summary
Document NestJS WebSocket gateway events and HTTP matchmaking REST endpoints in Swagger UI.

### Requirements
- Tag endpoints under `Matchmaking`, `Games`, and `Leaderboard`.
- Document incoming and outgoing WebSocket events (`join_room`, `roll_dice`, `move_piece`, `game_over`).
- Verify OpenAPI docs load at `/api/docs`.

---

## #2: Add active player count and room stats to /api/health response

- **Labels**: `complexity:trivial, backend, code-hygiene`

- **Complexity**: `100 pts` (Trivial)


### Summary
Expand the health check endpoint to return live operational stats on active games and connected WebSocket sockets.

### Requirements
- Return `{ status: "healthy", active_rooms: number, connected_sockets: number, uptime: number }`.
- Ensure response time is under 10ms.
- Add unit test asserting response shape.

---

## #3: Document Redis connection parameters and session timeout variables in .env.example

- **Labels**: `complexity:trivial, backend, documentation, good first issue`

- **Complexity**: `100 pts` (Trivial)


### Summary
Provide clear documentation and default fallback values for Redis and game server environment variables in `.env.example`.

### Requirements
- Document `REDIS_HOST`, `REDIS_PORT`, `SESSION_SECRET`, and `TURN_TIMEOUT_SECONDS`.
- Add comments explaining local Redis setup with Docker.
- Ensure server logs clear warnings if Redis connection fails.

---

## #4: Standardize WebSocket error event payloads with error code, message, and timestamp

- **Labels**: `complexity:trivial, backend, code-hygiene`

- **Complexity**: `100 pts` (Trivial)


### Summary
Ensure all WebSocket gateway exception filters emit a consistent JSON error structure.

### Requirements
- Emit errors as `{ event: "error", code: string, message: string, timestamp: string }`.
- Create global `WsExceptionFilter`.
- Add unit test verifying error payload emission on invalid event data.

---

## #5: Add structured logging for WebSocket client connect and disconnect events

- **Labels**: `complexity:trivial, backend, code-hygiene`

- **Complexity**: `100 pts` (Trivial)


### Summary
Improve game server observability by logging player connection, disconnection, and room join events.

### Requirements
- Log player public key, socket ID, and room ID on connection and disconnection.
- Use structured JSON logger in production environment.
- Verify zero sensitive data is logged.

---

## #6: Add Jest unit test verifying player move validator rejects out-of-turn actions

- **Labels**: `complexity:trivial, backend, testing, good first issue`

- **Complexity**: `100 pts` (Trivial)


### Summary
Ensure the move validator service rejects actions from players whose turn is not currently active.

### Requirements
- Write test in `src/game/move-validator.spec.ts`.
- Simulate Player 2 attempting to move when it is Player 1's turn.
- Verify validator throws `NotYourTurnException` and passes with `npm test`.

---

## #7: Add npm audit and package dependency check script to root package.json

- **Labels**: `complexity:trivial, backend, ci, security`

- **Complexity**: `100 pts` (Trivial)


### Summary
Configure automated dependency security audits to guard against vulnerable packages.

### Requirements
- Add `"audit": "npm audit --audit-level=high"` in `package.json`.
- Add CI step verifying dependency health.
- Document in `CONTRIBUTING.md`.

---

## #8: Document Elo rating calculation formula and leaderboard update intervals in docs/

- **Labels**: `complexity:trivial, backend, documentation`

- **Complexity**: `100 pts` (Trivial)


### Summary
Provide mathematical documentation for Elo ranking calculations and Redis sorted-set scoring in `docs/elo-rating.md`.

### Requirements
- Document K-factor scaling (`K = 32`) and win/loss expectation formulas.
- Explain Redis `ZADD` and `ZREVRANGE` operations for global top 100 leaderboard.
- Include Python / TypeScript code snippet example.

---

## #9: Add game server architecture diagram and WebSocket protocol docs to README.md

- **Labels**: `complexity:trivial, backend, documentation`

- **Complexity**: `100 pts` (Trivial)


### Summary
Update backend `README.md` with system architecture and message protocol specification.

### Requirements
- Add Mermaid diagram of client-gateway-redis-soroban interaction.
- Provide JSON payload examples for core game actions.
- Verify markdown formatting renders properly on GitHub.

---
