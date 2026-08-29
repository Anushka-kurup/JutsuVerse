import asyncio
import time
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from game.engine import GameEngine

app = FastAPI()

TICK_HZ = 10
TICK_DT = 1.0 / TICK_HZ


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
                # pure signaling relay: forward to the other socket in the room
                for pid, sock in room.sockets.items():
                    if pid != player_id:
                        await sock.send_text(json.dumps(msg))
    except WebSocketDisconnect:
        room.sockets.pop(player_id, None)
        if not room.sockets:
            rooms.pop(room_id, None)


async def tick_loop():
    while True:
        for room in list(rooms.values()):
            if room.engine:
                room.engine.tick(TICK_DT)
                await room.broadcast_state()
        await asyncio.sleep(TICK_DT)


@app.on_event("startup")
async def startup():
    asyncio.create_task(tick_loop())


@app.get("/")
async def health():
    return {"status": "ok", "rooms": list(rooms.keys())}
