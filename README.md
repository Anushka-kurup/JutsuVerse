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
  requirements.txt   Backend dependencies
  game/
    engine.py         GameEngine — turns signs into actions and resolves combat
    state.py           Match/PlayerState dataclasses
    rules.py            Balance constants and sign → action mapping
  player_client.py   Optional standalone webcam client (OpenCV + MediaPipe, runs in a native window)

frontend/
  src/
    main.ts           App UI, WebSocket client, hold-to-cast logic
    signDetector.ts   In-browser hand-sign detection (YOLOX-Nano via onnxruntime-web)
    types.ts          Shared message/state types
    style.css
  index.html
  public/models/
    yolox_nano.onnx   Custom-trained 16-class hand-sign detector
```

## Running the backend

Requires Python 3.10+ (the code uses `X | None` union type hints — on older
Python you'll hit `TypeError: unsupported operand type(s) for |: 'type' and
'NoneType'`; check with `python --version` and create the venv below with a
3.10+ interpreter).

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

That starts the server on `http://localhost:8000` (equivalent to running
`uvicorn main:app --host 0.0.0.0 --port 8000 --reload`). Binding to
`0.0.0.0` means a friend on the same network can also reach it at
`ws://<your-LAN-IP>:8000` instead of running their own backend.

The server exposes:
- `GET /` — health check, lists active rooms
- `WS /ws/{room_id}/{player_id}` — join a room (max 2 players per room)

## Running the frontend

Requires Node.js 18+.

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL (e.g. `http://localhost:5173`) in two browser tabs/windows (or two devices) to simulate both players. On the connect screen, point both at the same server URL and room name, but give each a distinct player ID.

In the game screen you can either click-and-hold the sign buttons, or click "Enable camera" to cast signs by making the hand gesture in front of your webcam. Detection runs a custom-trained YOLOX-Nano ONNX model (`frontend/public/models/yolox_nano.onnx`, already committed to the repo) locally in the browser via `onnxruntime-web`; the WASM runtime itself loads from a CDN on first use, so internet access is required for that part. Camera access needs a "secure context" (`localhost` or HTTPS) — `npm run dev` already satisfies that on every machine, so no extra setup is needed there.

> **Note:** `signDetector.ts` currently has placeholder class names (`class_0`..`class_15`) — the model's real 16 class labels and their training order aren't recorded anywhere in this repo, so detected signs won't show correct names until `CLASS_NAMES` in that file is updated.

## Optional: native webcam client

`backend/player_client.py` is a standalone alternative to the browser camera flow — it opens its own OpenCV window instead of running in the browser. It needs its own dependencies (not part of the backend server's requirements):

```bash
pip install opencv-python "mediapipe==0.10.14" websockets
python player_client.py --server ws://localhost:8000 --room match1 --player p1
```

> **Note:** pin `mediapipe==0.10.14` exactly — newer mediapipe releases (1.0+) dropped the
> `mp.solutions.hands` API this script (and the meme classifier tooling under
> `frontend/public/models/memes/`) depends on. An unpinned `pip install mediapipe` grabs the
> latest release and fails with `AttributeError: module 'mediapipe' has no attribute 'solutions'`.

## Building for production

```bash
cd frontend
npm run build
```

Outputs static assets to `frontend/dist/`.

## Troubleshooting

- **Camera button fails / permission denied** — check your OS and browser have granted camera access to the site, and that no other app is using the camera.
- **Can't connect to the other player** — confirm both are using the exact same room name and pointing at the same backend server address.
