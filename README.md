# JutsuVerse 忍

JutsuVerse is a real-time, two-player hand-sign duel. Players cast actions with the on-screen controls or a webcam, while an authoritative FastAPI server manages rooms, combat, and state updates over WebSockets.

## Features

- Two-player rooms with server-authoritative combat
- Browser-based hand-sign recognition using a local YOLOX ONNX model
- ONNX Runtime Web/WASM inference with no model CDN dependency
- Peer-to-peer WebRTC camera video with signaling relayed by the server
- On-screen controls when a webcam is unavailable

The current game signs are:

- `TIGER` — fire attack
- `SNAKE` — water attack
- `BIRD` — wind attack
- `RAM` — reflect
- `BOAR` — protect

Fire beats Wind, Wind beats Water, and Water beats Fire. Hold a sign for about one second to cast it. Casting uses energy, which regenerates over time.

## Project structure

```text
backend/
  main.py                 FastAPI app, WebSocket rooms, and game loop
  game/
    engine.py             Combat engine
    rules.py              Balance constants and sign mappings
    state.py              Match and player state
  player_client.py        Optional native OpenCV/MediaPipe client

frontend/
  public/models/
    yolox_nano.onnx       Local hand-sign recognition model
  src/
    main.ts               UI, WebSocket client, and WebRTC video
    handTracker.ts        ONNX webcam inference and detection rendering
    types.ts              Client message and game-state types
    style.css             Application styling
```

## Run locally

You need Python 3.10 or newer and a current Node.js installation.

### 1. Start the backend

From the repository root in PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install fastapi "uvicorn[standard]" websockets
Set-Location backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

The backend is then available at:

- Health check: `http://localhost:8000/`
- Game socket: `ws://localhost:8000/ws/{room_id}/{player_id}`

### 2. Start the frontend

Open a second PowerShell terminal at the repository root:

```powershell
Set-Location frontend
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

### 3. Connect two players

Open the frontend in two browser windows. In both windows, use `ws://localhost:8000` and the same room name, but enter a different player ID for each player. A room accepts up to two players.

Once connected, use the sign buttons or select **Enable camera**. Camera access requires browser permission. The ONNX model loads locally from `frontend/public/models/yolox_nano.onnx`.

## Production frontend build

```powershell
Set-Location frontend
npm run build
```

The generated site is written to `frontend/dist/`.

## Optional native webcam client

`backend/player_client.py` provides an alternative OpenCV window instead of browser-based recognition. Install its extra dependencies and run it from `backend/`:

```powershell
python -m pip install opencv-python mediapipe websockets
python player_client.py --server ws://localhost:8000 --room match1 --player p1
```

## Model attribution

The browser detector uses the YOLOX hand-sign model and preprocessing approach from [Kazuhito00/NARUTO-HandSignDetection](https://github.com/Kazuhito00/NARUTO-HandSignDetection).
