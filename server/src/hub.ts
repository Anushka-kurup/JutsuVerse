import {
  ClientMsg,
  type InputMsg,
  type Seat,
  type ServerMsg,
} from "@jutsu/protocol";
import type { RawData, WebSocket } from "ws";
import { markReady, publicState, receiveInput, restartMatch } from "./match.ts";
import {
  joinRoom,
  leaveSocket,
  locationOf,
  type Room,
} from "./rooms.ts";

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMsg, except?: Seat): void {
  for (const p of room.players.values()) {
    if (except && p.seat === except) continue;
    send(p.ws, msg);
  }
}

export function handleConnection(ws: WebSocket): void {
  ws.on("message", (data: RawData) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "invalid json" });
      return;
    }

    const result = ClientMsg.safeParse(parsed);
    if (!result.success) {
      send(ws, {
        type: "error",
        code: "bad_message",
        message: result.error.issues[0]?.message ?? "invalid message",
      });
      return;
    }

    try {
      dispatch(ws, result.data);
    } catch (err) {
      const code = err instanceof Error ? err.name : "error";
      const message = err instanceof Error ? err.message : "server error";
      send(ws, { type: "error", code, message });
    }
  });

  ws.on("pong", () => {
    const loc = locationOf(ws);
    if (loc) {
      const player = loc.room.players.get(loc.seat);
      if (player) player.alive = true;
    }
  });

  ws.on("close", () => {
    onLeave(ws);
  });
}

function dispatch(ws: WebSocket, msg: ClientMsg): void {
  switch (msg.type) {
    case "join":
      onJoin(ws, msg.code, msg.name);
      return;
    case "ready":
      onReady(ws);
      return;
    case "input":
      onInput(ws, msg);
      return;
    case "signal": {
      const loc = locationOf(ws);
      if (!loc) return;
      broadcast(
        loc.room,
        { type: "signal", from: loc.seat, payload: msg.payload },
        loc.seat,
      );
      return;
    }
    case "reset":
      onReset(ws);
      return;
    case "leave":
      onLeave(ws);
      return;
  }
}

function onReset(ws: WebSocket): void {
  const loc = locationOf(ws);
  if (!loc) return;
  loc.room.match = restartMatch(loc.room.players.keys());
  broadcast(loc.room, {
    type: "match_state",
    phase: loc.room.match.phase,
    winner: loc.room.match.winner,
  });
  broadcast(loc.room, { type: "state", ...publicState(loc.room.match) });
}

function onJoin(ws: WebSocket, code?: string, name?: string): void {
  if (locationOf(ws)) {
    send(ws, {
      type: "error",
      code: "already_joined",
      message: "already in a room",
    });
    return;
  }

  const { room, player } = joinRoom(ws, { code, name });
  if (room.players.size === 2 && room.match.phase === "ended") {
    room.match = restartMatch([]);
  }
  send(ws, {
    type: "joined",
    playerId: player.id,
    seat: player.seat,
    code: room.code,
    peerPresent: room.players.size === 2,
    name: player.name,
  });
  send(ws, { type: "match_state", phase: room.match.phase });

  if (room.players.size === 2) {
    const other = [...room.players.values()].find((p) => p.seat !== player.seat);
    if (other) {
      send(ws, { type: "peer_joined", seat: other.seat, name: other.name });
    }
    broadcast(
      room,
      { type: "peer_joined", seat: player.seat, name: player.name },
      player.seat,
    );
  }
}

function onReady(ws: WebSocket): void {
  const loc = locationOf(ws);
  if (!loc) return;
  loc.room.match = markReady(loc.room.match, loc.seat);
  broadcast(loc.room, {
    type: "match_state",
    phase: loc.room.match.phase,
    winner: loc.room.match.winner,
  });
}

function onInput(ws: WebSocket, msg: InputMsg): void {
  const loc = locationOf(ws);
  if (!loc) return;
  loc.room.match = receiveInput(loc.room.match, loc.seat, msg);
}

function onLeave(ws: WebSocket): void {
  const room = leaveSocket(ws);
  if (!room) return;
  if (room.players.size === 0) return;

  const remaining = [...room.players.values()][0];
  if (room.match.phase === "live") {
    room.match = { ...room.match, phase: "ended", winner: remaining.seat };
  }
  send(remaining.ws, {
    type: "peer_left",
    seat: remaining.seat === "a" ? "b" : "a",
  });
  send(remaining.ws, {
    type: "match_state",
    phase: room.match.phase,
    winner: room.match.winner,
  });
}
