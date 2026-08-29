import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { ServerMsg } from "@jutsu/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { handleConnection } from "./hub.ts";
import { startLoop } from "./loop.ts";

class MessageInbox {
  private messages: ServerMsg[] = [];
  private listeners: Array<() => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(String(data)) as ServerMsg);
      for (const listener of this.listeners.splice(0)) listener();
    });
  }

  async waitFor(predicate: (message: ServerMsg) => boolean): Promise<ServerMsg> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 50);
        this.listeners.push(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    throw new Error("timed out waiting for WebSocket message");
  }
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

test("two clients can join, fight, signal, and reset", async () => {
  const httpServer = http.createServer();
  const webSocketServer = new WebSocketServer({ server: httpServer, path: "/ws" });
  webSocketServer.on("connection", handleConnection);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));

  const port = (httpServer.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${port}/ws`;
  const first = await openSocket(url);
  const second = await openSocket(url);
  const firstInbox = new MessageInbox(first);
  const secondInbox = new MessageInbox(second);
  const loop = startLoop();

  try {
    first.send(JSON.stringify({ type: "join", code: "E2ETEST", name: "Naruto" }));
    const firstJoined = await firstInbox.waitFor((message) => message.type === "joined");
    assert.equal(firstJoined.type === "joined" && firstJoined.seat, "a");

    second.send(JSON.stringify({ type: "join", code: "E2ETEST", name: "Sasuke" }));
    const secondJoined = await secondInbox.waitFor((message) => message.type === "joined");
    assert.equal(secondJoined.type === "joined" && secondJoined.seat, "b");
    await firstInbox.waitFor((message) => message.type === "peer_joined");

    first.send(JSON.stringify({ type: "ready" }));
    second.send(JSON.stringify({ type: "ready" }));
    await Promise.all([
      firstInbox.waitFor((message) => message.type === "match_state" && message.phase === "live"),
      secondInbox.waitFor((message) => message.type === "match_state" && message.phase === "live"),
    ]);

    let sequence = 0;
    for (const sign of ["TIGER", "SNAKE", "RAM"] as const) {
      first.send(JSON.stringify({ type: "input", seq: ++sequence, sign, edge: "down", tClient: 0 }));
      first.send(JSON.stringify({ type: "input", seq: ++sequence, sign, edge: "up", tClient: 0 }));
    }
    const attackState = await firstInbox.waitFor(
      (message) => message.type === "state" && message.a.moveId === "tiger",
    );
    assert.equal(attackState.type === "state" && attackState.a.stance, "startup");

    const signal = { kind: "webrtc-ice", candidate: { candidate: "test" } };
    first.send(JSON.stringify({ type: "signal", payload: signal }));
    const relayed = await secondInbox.waitFor((message) => message.type === "signal");
    assert.deepEqual(relayed.type === "signal" && relayed.payload, signal);

    first.send(JSON.stringify({ type: "reset" }));
    const resetState = await firstInbox.waitFor(
      (message) => message.type === "state" && message.tick === 0,
    );
    assert.equal(resetState.type === "state" && resetState.a.hp, 6);
    assert.equal(resetState.type === "state" && resetState.b.hp, 6);
  } finally {
    clearInterval(loop);
    first.close();
    second.close();
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
