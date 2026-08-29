# JutsuVerse 忍

A real-time, hand-sign-controlled duel game. Two players form ninja hand seals — either with physical hand gestures (via webcam) or on-screen buttons — and a FastAPI server referees the match over WebSockets: hold-to-cast timing, elemental clashes, energy, and defensive counters are all resolved server-side so neither client can cheat.

## How it works

- **TIGER** → Fire attack
- **SNAKE** → Water attack
- **BIRD** → Wind attack
- **RAM** → Reflect (counters an attack)
- **BOAR** → Protect (blocks an attack)

Fire beats Wind, Wind beats Water, Water beats Fire. Hold a sign for about a second to cast it; casting costs energy, which regenerates over time. Reflect and Protect have limited uses per match.

## Project structure

```
backend/
  main.py            FastAPI app: WebSocket rooms, game tick loop
  game/
    engine.py         GameEngine — turns signs into actions and resolves combat
    state.py           Match/PlayerState dataclasses
    rules.py            Balance constants and sign → action mapping
  player_client.py   Optional standalone webcam client (OpenCV + MediaPipe, runs in a native window)

frontend/
  src/
    main.ts           App UI, WebSocket client, hold-to-cast logic
    handTracker.ts    In-browser hand-sign detection (MediaPipe Tasks Vision)
    types.ts          Shared message/state types
    style.css
  index.html
```

## Running the backend

Requires Python 3.10+ (the code uses `X | None` union type hints).

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi "uvicorn[standard]" websockets
uvicorn main:app --host 0.0.0.0 --port 8000
```

The server exposes:
- `GET /` — health check, lists active rooms
- `WS /ws/{room_id}/{player_id}` — join a room (max 2 players per room)

## Running the frontend

Requires Node.js.

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL (e.g. `http://localhost:5173`) in two browser tabs/windows (or two devices) to simulate both players. On the connect screen, point both at the same server URL and room name, but give each a distinct player ID.

In the game screen you can either click-and-hold the sign buttons, or click "Enable camera" to cast signs by making the hand gesture in front of your webcam (requires camera permission and internet access, since the hand-tracking model loads from a CDN on first use).

## Optional: native webcam client

`backend/player_client.py` is a standalone alternative to the browser camera flow — it opens its own OpenCV window instead of running in the browser. It needs its own dependencies (not part of the backend server's requirements):

```bash
pip install opencv-python mediapipe websockets
python player_client.py --server ws://localhost:8000 --room match1 --player p1
```

## Building for production

```bash
cd frontend
npm run build
```

Outputs static assets to `frontend/dist/`.
