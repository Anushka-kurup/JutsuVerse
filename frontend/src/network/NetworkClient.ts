import { bus, Events } from "../core/EventBus";
import type { ClientMsg, ConnectOpts, Edge, FighterPublic, Seat, ServerMsg, Sign } from "../types";

/**
 * Owns the raw WebSocket to the game server (@jutsu/protocol). The server does
 * all the game logic — sequence matching, damage, energy — so this just:
 *   - join / ready / reset
 *   - stream confirmed seals as input edges (down then up)
 *   - turn `state` / `match_state` frames into bus events
 *
 * Knows nothing about Phaser or the DOM.
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private queued: ClientMsg[] = [];
  private seq = 0;
  private seat: Seat | null = null;
  private code = "";
  private peer = false;

  myId = "";

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  get mySeat(): Seat | null {
    return this.seat;
  }
  get roomCode(): string {
    return this.code;
  }
  get peerPresent(): boolean {
    return this.peer;
  }

  connect(opts: ConnectOpts): void {
    this.disconnect();
    this.myId = opts.player;
    const ws = new WebSocket(wsUrl(opts.server));
    this.ws = ws;

    ws.addEventListener("open", () => {
      // no room code → server allocates one and returns it in `joined`
      const room = opts.room.trim();
      this.raw(room ? { type: "join", code: room, name: opts.player } : { type: "join", name: opts.player });
      this.raw({ type: "ready" });
      for (const m of this.queued.splice(0)) ws.send(JSON.stringify(m));
      bus.emit(Events.NET_OPEN);
    });

    ws.addEventListener("message", (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      this.route(msg);
    });

    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        bus.emit(Events.NET_CLOSE);
      }
    });
    ws.addEventListener("error", () => bus.emit(Events.NET_ERROR, "Could not reach server"));
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    this.seat = null;
    this.code = "";
    this.peer = false;
    this.queued = [];
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "leave" }));
    ws?.close();
  }

  private route(msg: ServerMsg): void {
    switch (msg.type) {
      case "joined":
        this.seat = msg.seat;
        this.code = msg.code;
        this.peer = msg.peerPresent;
        bus.emit(Events.NET_JOINED, {
          code: msg.code,
          seat: msg.seat,
          peerPresent: msg.peerPresent,
        });
        if (msg.peerPresent) bus.emit(Events.PEER_JOINED);
        break;
      case "peer_joined":
        this.peer = true;
        bus.emit(Events.PEER_JOINED);
        break;
      case "peer_left":
        this.peer = false;
        bus.emit(Events.PEER_LEFT);
        break;
      case "state": {
        if (!this.seat) break;
        const me = this.seat === "a" ? msg.a : msg.b;
        const opp = this.seat === "a" ? msg.b : msg.a;
        bus.emit(Events.NET_STATE, { me, opp, tick: msg.tick } as {
          me: FighterPublic;
          opp: FighterPublic;
          tick: number;
        });
        break;
      }
      case "match_state":
        bus.emit(Events.NET_MATCH, { phase: msg.phase, winner: msg.winner ?? null });
        break;
      case "error":
        bus.emit(Events.NET_ERROR, msg.message);
        break;
      case "signal":
        bus.emit(Events.WEBRTC_SIGNAL, msg.payload);
        break;
    }
  }

  /** send a confirmed seal to the server: down then up */
  sendSeal(sign: string): void {
    if (!isSign(sign)) return;
    this.input(sign, "down");
    this.input(sign, "up");
  }

  reset(): void {
    this.raw({ type: "reset" });
    this.raw({ type: "ready" });
  }

  /** WebRTC signalling passthrough for VideoCall */
  signal(payload: unknown): void {
    this.raw({ type: "signal", payload });
  }

  private input(sign: Sign, edge: Edge): void {
    this.raw({ type: "input", seq: ++this.seq, sign, edge, tClient: performance.now() });
  }

  private raw(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queued.push(msg);
  }
}

function wsUrl(server: string): string {
  const u = new URL(server);
  if (u.protocol === "http:") u.protocol = "ws:";
  if (u.protocol === "https:") u.protocol = "wss:";
  u.pathname = "/ws";
  u.search = "";
  u.hash = "";
  return u.toString();
}

// keep in sync with @jutsu/protocol SIGNS
const SIGN_SET = new Set([
  "rat", "ox", "tiger", "hare", "dragon", "snake", "horse",
  "ram", "monkey", "bird", "dog", "boar", "gassho", "mizunoe",
]);
function isSign(s: string): s is Sign {
  return SIGN_SET.has(s);
}
