# JutsuVerse 忍

JutsuVerse is a real-time, two-player hand-sign duel. Players cast **sign sequences** with on-screen pads, the keyboard, or a webcam. An authoritative Node server manages rooms, matching, and combat over WebSockets.

## Features

- Six-character room codes (create / join)
- Server-authoritative sequence combat (same logic as the duel server)
- Browser-based hand-sign recognition using a local YOLOX ONNX model
- Peer-to-peer WebRTC camera video; signaling is relayed as opaque `signal` messages
- Keyboard (`A S W D F G`) and on-screen pads when a webcam is unavailable

Moves are sequences, not held single seals:

- `TIGER SNAKE RAM` — tiger
- `SNAKE RAM TIGER` — serpent
- `RAM TIGER BOAR` — ox
- `TIGER BOAR RAM` — boar
- `BIRD OX TIGER` — crane
- `OX BOAR BIRD` — hare
- `BIRD TIGER OX` — dragon
- `BOAR SNAKE` — guard (2s, incoming damage halved)

## Project structure

```text
packages/protocol/        Shared WebSocket schema (Zod)
server/                   Node game server (rooms, matcher, tick)
  src/rooms.ts            6-char room codes, two seats
  src/commands.ts         Sequence table
  src/sim.ts              Stance / hits
  src/hub.ts              join / ready / input / signal / leave
frontend/
  public/models/
    yolox_nano.onnx       Local hand-sign recognition model
  src/
    main.ts               UI, WebRTC, pads, camera
    net/wsClient.ts       Same-origin WebSocket client
    handTracker.ts        ONNX webcam inference
backend/                  Legacy FastAPI client helper (not used at runtime)
```

## Run locally

You need Node.js 20 or newer.

```bash
cd /path/to/JutsuVerse
npm install
npm run dev
```

That starts both processes:

- Game server: `http://localhost:8080/health`
- UI: `http://localhost:5173` (Vite proxies `/ws` to the game server)

Open two browser windows to the Vite URL. In one, leave **Room code** blank and click **Create duel**. Share the 6-character code. In the other, enter that code and **Join duel**.

On another laptop, open `http://<this-machine-ip>:5173`. Do not type a server URL — the page's own host is the socket, and Vite forwards `/ws` to the game process.

Camera access requires browser permission. The ONNX model loads from `frontend/public/models/yolox_nano.onnx`.

```bash
npm test
npm run typecheck
```

## Production frontend build

```bash
npm run build -w frontend
```

The generated site is written to `frontend/dist/`. The game server still needs to run on port 8080, or you need a reverse proxy that forwards `/ws`.

## Model attribution

The browser detector uses the YOLOX hand-sign model and preprocessing approach from [Kazuhito00/NARUTO-HandSignDetection](https://github.com/Kazuhito00/NARUTO-HandSignDetection).
