# JutsuVerse 忍

A real-time two-player hand-sign duel. The browser UI and local ONNX webcam detector live in `frontend/`; the authoritative TypeScript WebSocket server owns rooms, sign-sequence matching, combat, and match state.

## Run locally

Requires a current Node.js installation.

```bash
npm install
npm run dev
```

This starts:

- Frontend: `http://localhost:5173`
- Server health check: `http://localhost:8080/health`
- WebSocket server: `ws://localhost:8080/ws`

Open the frontend in two browser windows. Use the same room name and different player names. The first connection creates the named room; the second joins it.

## Controls

Use the on-screen seal buttons or enable the webcam. Both input methods send the same sign alphabet:

- `TIGER`
- `SNAKE`
- `RAM`
- `BOAR`
- `BIRD`
- `OX`

Moves are server-matched sign sequences rather than individual held attacks. Examples:

- Tiger: `TIGER → SNAKE → RAM`
- Serpent: `SNAKE → RAM → TIGER`
- Guard: `BOAR → SNAKE`

See `ARCHITECTURE.md` for the full command table and combat invariants.

## Project structure

```text
frontend/                 Existing JutsuVerse UI, ONNX detector, WebRTC video
packages/protocol/        Shared validated WebSocket protocol and game constants
server/                   Rooms, authoritative simulation, signaling relay, tests
```

The frontend sends sign `down`/`up` edges. Only the server recognizes complete move sequences and resolves hits. WebRTC camera video remains peer-to-peer; the server relays signaling data only.

## Checks

```bash
npm test
npm run typecheck
npm run build
```
