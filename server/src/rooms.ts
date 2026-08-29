import type { Seat } from "@jutsu/protocol";
import { WebSocket } from "ws";
import { createMatch, type MatchSession } from "./match.ts";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface Player {
  id: string;
  name: string;
  seat: Seat;
  ws: WebSocket;
  alive: boolean;
}

export interface Room {
  code: string;
  players: Map<Seat, Player>;
  match: MatchSession;
  createdAt: number;
}

const rooms = new Map<string, Room>();
const bySocket = new Map<WebSocket, { room: Room; seat: Seat }>();

function generateCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("could not allocate room code");
}

export function createRoom(requestedCode?: string): Room {
  const code = requestedCode?.trim().toUpperCase() || generateCode();
  if (rooms.has(code)) throw new Error("room_exists");
  const room: Room = {
    code,
    players: new Map(),
    match: createMatch(),
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function joinRoom(
  ws: WebSocket,
  opts: { code?: string; name?: string },
): { room: Room; player: Player } {
  const name = (opts.name ?? "Ronin").slice(0, 24);
  let room: Room;
  if (opts.code) {
    const requestedCode = opts.code.trim().toUpperCase();
    room = getRoom(requestedCode) ?? createRoom(requestedCode);
  } else {
    room = createRoom();
  }

  if (room.players.size >= 2) {
    const err = new Error("room_full");
    err.name = "room_full";
    throw err;
  }

  const seat: Seat = room.players.has("a") ? "b" : "a";
  const player: Player = {
    id: crypto.randomUUID(),
    name,
    seat,
    ws,
    alive: true,
  };
  room.players.set(seat, player);
  bySocket.set(ws, { room, seat });
  return { room, player };
}

export function leaveSocket(ws: WebSocket): Room | undefined {
  const loc = bySocket.get(ws);
  if (!loc) return undefined;
  bySocket.delete(ws);
  loc.room.players.delete(loc.seat);
  if (loc.room.players.size === 0) {
    rooms.delete(loc.room.code);
    return loc.room;
  }
  return loc.room;
}

export function locationOf(
  ws: WebSocket,
): { room: Room; seat: Seat } | undefined {
  return bySocket.get(ws);
}

export function liveRooms(): Room[] {
  return [...rooms.values()].filter((r) => r.match.phase === "live");
}

export function destroyRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  for (const p of room.players.values()) bySocket.delete(p.ws);
  rooms.delete(code);
}

export function allPlayers(): Player[] {
  const out: Player[] = [];
  for (const room of rooms.values()) out.push(...room.players.values());
  return out;
}
