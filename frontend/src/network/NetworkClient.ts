import { bus, Events } from "../core/EventBus";
import { TICK_HZ } from "../types";
import { GameSocket } from "../net/wsClient";
import type {
  ConnectOpts,
  Edge,
  FighterPublic,
  Seat,
  ServerMsg,
  Sign,
  SpecialPublic,
} from "../types";

/** The 6-7 contest from the local player's point of view. */
export interface SpecialView {
  reps: { me: number; opp: number };
  target: number;
  /** whole seconds left on the contest cap; 0 once it has resolved */
  secondsLeft: number;
  /** null while the contest is running */
  outcome: "me" | "opp" | "draw" | null;
  /** HP the winner actually gained — 0 when they were already at full health */
  healed: number;
}

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
  private heldSign: Sign | null = null;

  myId = "";
  myName = "";
  peerName = "";

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
        this.myName = msg.name;
        bus.emit(Events.NET_JOINED, {
          code: msg.code,
          seat: msg.seat,
          peerPresent: msg.peerPresent,
        });
        bus.emit(Events.NET_NAMES, { me: this.myName, opp: this.peerName });
        if (msg.peerPresent) bus.emit(Events.PEER_JOINED);
        break;
      case "peer_joined":
        this.peer = true;
        this.peerName = msg.name;
        bus.emit(Events.NET_NAMES, { me: this.myName, opp: this.peerName });
        bus.emit(Events.PEER_JOINED);
        break;
      case "peer_left":
        this.peer = false;
        this.peerName = "";
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
        if (msg.phase === "ended") this.heldSign = null;
        bus.emit(Events.NET_MATCH, {
          phase: msg.phase,
          winner: msg.winner ?? null,
          cam: msg.cam,
          ready: msg.ready,
          countdown: msg.countdown ?? null,
          special: msg.special ? this.viewSpecial(msg.special) : null,
        });
        break;
      case "error":
        bus.emit(Events.NET_ERROR, msg.message);
        break;
      case "signal":
        bus.emit(Events.WEBRTC_SIGNAL, msg.payload);
        break;
    }
  }

  private viewSpecial(sp: SpecialPublic): SpecialView {
    const iAmA = this.seat !== "b";
    return {
      reps: {
        me: iAmA ? sp.reps.a : sp.reps.b,
        opp: iAmA ? sp.reps.b : sp.reps.a,
      },
      target: sp.target,
      secondsLeft: Math.ceil(sp.ticksLeft / TICK_HZ),
      outcome:
        sp.winner === null || this.seat === null
          ? null
          : sp.winner === "draw"
            ? "draw"
            : sp.winner === this.seat
              ? "me"
              : "opp",
      healed: sp.healed,
    };
  }

  /** My own 6-7 rep count during the contest. The server clamps it to monotonic. */
  sendReps(reps: number): void {
    this.sock.send({ type: "reps", seq: ++this.seq, reps, tClient: performance.now() });
  }

  /** send a confirmed seal to the server: down then up */
  sendSeal(sign: string): void {
    if (!isSign(sign)) return;
    this.input(sign, "down");
    this.input(sign, "up");
  }

  /** Stream only changes in the currently recognized valid gesture. */
  setHeldSign(sign: string | null): void {
    const valid = sign !== null && isSign(sign) ? sign : null;
    if (valid === this.heldSign) return;
    this.heldSign = valid;
    this.sock.send({
      type: "hold",
      seq: ++this.seq,
      sign: valid,
      tClient: performance.now(),
    });
  }

  /** stage 1: the local camera is on */
  cameraReady(enabled = true): void {
    this.sock.send({ type: "ready", stage: "camera", enabled });
  }

  /** stage 2: this player pressed Start */
  startReady(): void {
    this.sock.send({ type: "ready", stage: "start" });
  }

  rematchReady(): void {
    this.sock.send({ type: "ready", stage: "rematch" });
  }

  /** WebRTC signalling passthrough for VideoCall */
  signal(payload: unknown): void {
    this.sock.send({ type: "signal", payload });
  }

  private input(sign: Sign, edge: Edge): void {
    this.sock.send({ type: "input", seq: ++this.seq, sign, edge, tClient: performance.now() });
  }
}

// castable seals the client may send. Subset of @jutsu/protocol SIGNS —
// `mizunoe` (壬) is intentionally omitted: the detector can't recognise it.
const SIGN_SET = new Set([
  "rat", "ox", "tiger", "hare", "dragon", "snake", "horse",
  "ram", "monkey", "bird", "dog", "boar", "gassho",
]);
function isSign(s: string): s is Sign {
  return SIGN_SET.has(s);
}
