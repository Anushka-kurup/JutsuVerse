import asyncio
import time
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from game.engine import GameEngine
from game.meme_counter import MemeCounterEngine

app = FastAPI()

TICK_HZ = 10
TICK_DT = 1.0 / TICK_HZ


async def relay_signal(sockets: dict[str, WebSocket], sender_id: str, msg: dict):
    """Forward a WebRTC signaling message to the other socket(s) in a room."""
    raw = json.dumps(msg)
    for pid, sock in sockets.items():
        if pid != sender_id:
            await sock.send_text(raw)


class Room:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.sockets: dict[str, WebSocket] = {}
        self.engine: GameEngine | None = None

    def is_full(self):
        return len(self.sockets) >= 2

    async def broadcast_state(self):
        if not self.engine:
            return
        payload = json.dumps({"type": "state", "match": self.engine.match.to_public_dict()})
        for ws in list(self.sockets.values()):
            try:
                await ws.send_text(payload)
            except Exception:
                pass


rooms: dict[str, Room] = {}


@app.websocket("/ws/{room_id}/{player_id}")
async def ws_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    await websocket.accept()

    room = rooms.setdefault(room_id, Room(room_id))
    if room.is_full() and player_id not in room.sockets:
        await websocket.send_text(json.dumps({"type": "error", "message": "room full"}))
        await websocket.close()
        return

    room.sockets[player_id] = websocket

    if len(room.sockets) == 2 and room.engine is None:
        p1_id, p2_id = list(room.sockets.keys())
        room.engine = GameEngine(p1_id, p2_id)
        # tell each player who their opponent is and who should start the
        # WebRTC handshake, so browser video calls can be set up peer-to-peer
        await room.sockets[p1_id].send_text(json.dumps({"type": "webrtc-peer", "peer_id": p2_id, "initiator": True}))
        await room.sockets[p2_id].send_text(json.dumps({"type": "webrtc-peer", "peer_id": p1_id, "initiator": False}))
        await room.broadcast_state()

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            if msg.get("type") == "sign" and room.engine:
                room.engine.on_sign(player_id, msg.get("sign", "UNKNOWN"))
            elif msg.get("type") == "reset" and room.engine:
                p1_id, p2_id = room.engine.match.p1.player_id, room.engine.match.p2.player_id
                room.engine = GameEngine(p1_id, p2_id)
                await room.broadcast_state()
            elif msg.get("type") in ("webrtc-offer", "webrtc-answer", "webrtc-ice"):
                await relay_signal(room.sockets, player_id, msg)
    except WebSocketDisconnect:
        room.sockets.pop(player_id, None)
        if not room.sockets:
            rooms.pop(room_id, None)


class MemeRoom:
    """
    Same pairing/signaling shape as Room, but for the meme-repetition
    counter mode instead of the ninja duel: two players share a room, each
    performs meme gestures in front of their camera, and the server tallies
    how many times each one has done each gesture (e.g. a 6-7 competition).
    """

    def __init__(self, room_id: str):
        self.room_id = room_id
        self.sockets: dict[str, WebSocket] = {}
        self.engine: MemeCounterEngine | None = None

    def is_full(self):
        return len(self.sockets) >= 2

    async def broadcast_state(self):
        if not self.engine:
            return
        payload = json.dumps({"type": "meme_state", "match": self.engine.match.to_public_dict()})
        for ws in list(self.sockets.values()):
            try:
                await ws.send_text(payload)
            except Exception:
                pass


meme_rooms: dict[str, MemeRoom] = {}


@app.websocket("/ws/meme/{room_id}/{player_id}")
async def ws_meme_endpoint(websocket: WebSocket, room_id: str, player_id: str):
    await websocket.accept()

    room = meme_rooms.setdefault(room_id, MemeRoom(room_id))
    if room.is_full() and player_id not in room.sockets:
        await websocket.send_text(json.dumps({"type": "error", "message": "room full"}))
        await websocket.close()
        return

    room.sockets[player_id] = websocket

    if len(room.sockets) == 2 and room.engine is None:
        p1_id, p2_id = list(room.sockets.keys())
        room.engine = MemeCounterEngine(p1_id, p2_id)
        await room.sockets[p1_id].send_text(json.dumps({"type": "webrtc-peer", "peer_id": p2_id, "initiator": True}))
        await room.sockets[p2_id].send_text(json.dumps({"type": "webrtc-peer", "peer_id": p1_id, "initiator": False}))
        await room.broadcast_state()

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            if msg.get("type") == "meme" and room.engine:
                room.engine.on_meme(player_id, msg.get("label", "UNKNOWN"))
                await room.broadcast_state()
            elif msg.get("type") == "reset" and room.engine:
                p1_id, p2_id = room.engine.match.p1.player_id, room.engine.match.p2.player_id
                room.engine = MemeCounterEngine(p1_id, p2_id)
                await room.broadcast_state()
            elif msg.get("type") in ("webrtc-offer", "webrtc-answer", "webrtc-ice"):
                await relay_signal(room.sockets, player_id, msg)
    except WebSocketDisconnect:
        room.sockets.pop(player_id, None)
        if not room.sockets:
            meme_rooms.pop(room_id, None)


async def tick_loop():
    while True:
        for room in list(rooms.values()):
            if room.engine:
                room.engine.tick(TICK_DT)
                await room.broadcast_state()
        # meme rooms have no periodic state (no timer) -- they only change
        # on an incoming "meme" message, which already triggers its own broadcast
        await asyncio.sleep(TICK_DT)


@app.on_event("startup")
async def startup():
    asyncio.create_task(tick_loop())


@app.get("/")
async def health():
    return {"status": "ok", "rooms": list(rooms.keys()), "meme_rooms": list(meme_rooms.keys())}


if __name__ == "__main__":
    import uvicorn

    # host="0.0.0.0" so a friend on the same network can point their
    # frontend's "Server" field at your machine's IP and join your room
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
