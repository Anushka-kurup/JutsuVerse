# Jutsu Duel

1v1 real-time arcade fighter. Both players act at the same time. Moves are **sequences of hand signs** (`TIGER SNAKE RAM` tiger, `BOAR SNAKE` guard). Keyboard, on-screen pads, or webcam — all emit the same sign names.

**If you are an agent or you are about to change combat, netcode, or input: read [ARCHITECTURE.md](./ARCHITECTURE.md) first.**

## Run

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- Server health: http://localhost:8080/health

Open two windows. Create a room in one, join the code in the other. Focus a window to use the keyboard (`A S W D F G` → TIGER SNAKE RAM BOAR BIRD OX), click the pads, or **Enable camera** and hold the seals in sequence.

```bash
npm test
npm run typecheck
```

## What this build is

Playable fight loop over WebSockets. Hand signs feed `{ type: "input", sign, edge }` — the server matches sequences. No accounts. Opponent webcam (WebRTC) is not in this build.
