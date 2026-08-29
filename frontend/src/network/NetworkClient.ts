import { bus, Events } from "../core/EventBus";
import { GameSocket } from "../net/wsClient";
import type { ConnectOpts, Edge, FighterPublic, Seat, ServerMsg, Sign } from "../types";

/**
 * Game socket to the authoritative server (@jutsu/protocol). The connection
 * itself is same-origin `/ws` (Vite proxies it in dev) and stays open for the
 * page lifetime — join / leave / ready / input are messages on that socket.
 *
 * Game logic stays on the server. This client:
 *   - join / ready / reset
 *   - stream confirmed seals as input edges (down then up)
 *   - turn `state` / `match_state` frames into bus events
 *
 * Knows nothing about Phaser or the DOM.
 */
export class NetworkClient {
  private sock = new GameSocket();
  private seq = 0;
  private seat: Seat | null = null;
  private code = "";
  private peer = false;

  myId = "";

  constructor() {
    this.sock.onopen = () => bus.emit(Events.NET_OPEN);
    this.sock.onclose = () => {
      this.seat = null;
      this.code = "";
      this.peer = false;
      bus.emit(Events.NET_CLOSE);
    };
    this.sock.onerror = () => bus.emit(Events.NET_ERROR, "Could not reach server");
    this.sock.connect((msg) => this.route(msg));
  }

  get connected(): boolean {
    return this.sock.connected;
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

  /** Join a room (or create one if `opts.room` is empty). Reuses the live socket. */
  connect(opts: ConnectOpts): void {
    this.myId = opts.player;
    this.seq = 0;
    this.sock.connect((msg) => this.route(msg));
    // same socket can leave then join; drop a stale seat so a rematch-from-menu works
    if (this.seat !== null) {
      this.sock.send({ type: "leave" });
      this.seat = null;
      this.code = "";
      this.peer = false;
    }
    const room = opts.room.trim().toUpperCase();
    this.sock.send(room ? { type: "join", code: room, name: opts.player } : { type: "join", name: opts.player });
  }

  /** Leave the current room. The socket stays open for the next join. */
  disconnect(): void {
    this.seat = null;
    this.code = "";
    this.peer = false;
    this.sock.send({ type: "leave" });
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

  /** tell the server this player is ready (sent once the local camera is on) */
  ready(): void {
    this.sock.send({ type: "ready" });
  }

  reset(): void {
    this.sock.send({ type: "reset" });
    this.sock.send({ type: "ready" }); // rematch: cameras already on, go straight to the countdown
  }

  /** WebRTC signalling passthrough for VideoCall */
  signal(payload: unknown): void {
    this.sock.send({ type: "signal", payload });
  }

  private input(sign: Sign, edge: Edge): void {
    this.sock.send({ type: "input", seq: ++this.seq, sign, edge, tClient: performance.now() });
  }
}

// keep in sync with @jutsu/protocol SIGNS
const SIGN_SET = new Set([
  "rat", "ox", "tiger", "hare", "dragon", "snake", "horse",
  "ram", "monkey", "bird", "dog", "boar", "gassho", "mizunoe",
]);
function isSign(s: string): s is Sign {
  return SIGN_SET.has(s);
}
