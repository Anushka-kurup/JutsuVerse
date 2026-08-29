import assert from "node:assert/strict";
import test from "node:test";
import { ClientMsg, MAX_HP } from "@jutsu/protocol";
import type { WebSocket } from "ws";
import { restartMatch } from "./match.ts";
import { destroyRoom, joinRoom } from "./rooms.ts";

test("a requested room code is created and joined by exactly two players", () => {
  const firstSocket = {} as WebSocket;
  const secondSocket = {} as WebSocket;
  const thirdSocket = {} as WebSocket;
  const code = "ROOMTST";

  try {
    const first = joinRoom(firstSocket, { code, name: "Naruto" });
    const second = joinRoom(secondSocket, { code: code.toLowerCase(), name: "Sasuke" });

    assert.equal(first.room, second.room);
    assert.equal(first.player.seat, "a");
    assert.equal(second.player.seat, "b");
    assert.throws(() => joinRoom(thirdSocket, { code, name: "Kakashi" }), /room_full/);
  } finally {
    destroyRoom(code);
  }
});

test("reset recreates a live match when both seats remain ready", () => {
  const match = restartMatch(["a", "b"]);
  assert.equal(match.phase, "live");
  assert.equal(match.fighters.a.hp, MAX_HP);
  assert.equal(match.fighters.b.hp, MAX_HP);
  assert.equal(match.tick, 0);
});

test("reset is a valid client protocol message", () => {
  assert.equal(ClientMsg.safeParse({ type: "reset" }).success, true);
});
