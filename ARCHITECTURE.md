# Jutsu Duel — architecture for implementers and agents

If you are an LLM: **read this whole file before editing.** Do not invent a round engine. Do not send move names from the client. Do not detect full jutsu in computer vision. Sequences of **hand signs** are the game; keyboard and webcam are adapters on the same alphabet.

This is a 1v1 real-time arcade fighter in the browser. Both players act at any moment (attack or guard). A move is a **sign sequence**. `TIGER SNAKE RAM` is tiger, `BOAR SNAKE` is a timed guard (damage halved for 2s). Keyboard keys and camera seals all emit those names.

## How to run

```
npm install
npm run dev      # server :8080, client :5173 (Vite proxies /ws)
npm test         # matcher + sim, no browser
npm run typecheck
```

Open two browser windows to `http://localhost:5173`. Create a room in one, join the code in the other. Focus a window to type; two tabs cannot share one keyboard. Use the on-screen pads or **Enable camera** (MediaPipe) to play with hands.

## Invariants (do not break)

1. Clients send `{ type: "input", sign, edge }` only. Never `move: "tiger"`.
2. The server is the only sequence matcher and the only hit/block referee.
3. Both fighters tick every 50ms independently. No turns. No lock-in.
4. Devices (keyboard, pads, gestures) emit `TIGER|SNAKE|RAM|BOAR|BIRD|OX`. They do not know jutsu names (lowercase move ids).
5. Video, if added, is WebRTC P2P and **never** an input path. Do not send gameplay on `{ type: "signal" }` — that is an opaque peer relay.
6. Guard is the sequence `BOAR,SNAKE`, not a held sign. On match, enter `block` for 40 ticks (2s). Hits during that window deal `floor(damage/2)` (min 1) and do **not** apply hitstun. `BOAR,SNAKE` may cancel your own startup.
7. Matcher is **suffix + no extra signs in the middle**. `[BOAR, TIGER, SNAKE, RAM]` matches tiger; `[TIGER, BOAR, SNAKE, RAM]` does not.
8. Hits apply on the **first active tick** of a move, not every active tick.
9. Per-move startup lives on the command table (tiger 7 ticks / 350ms). Do not hardcode one startup for every attack.
10. Keepalive `down` on an already-held sign must **not** append to the sequence buffer (`applyEdge` in `sim.ts`).

## File map

| Path | What it does |
|---|---|
| `packages/protocol/src/index.ts` | Zod envelopes, `Sign`, `TICK_HZ`, `MAX_HP`, `ClientMsg` / `ServerMsg` |
| `server/src/commands.ts` | `COMMANDS` table + `matchBuffer()` + `consumeSuffix()` |
| `server/src/sim.ts` | `applyEdge`, `stepFighter`, `resolveHits` — pure, unit-tested |
| `server/src/match.ts` | Delay buffer, ready → live, `tickMatch`, HP 0 → ended |
| `server/src/rooms.ts` | 6-char codes, two seats, socket index |
| `server/src/hub.ts` | WS dispatch (`join` / `ready` / `input` / `signal` / `leave`) |
| `server/src/loop.ts` | 20 Hz tick + 5s ping heartbeat |
| `server/src/index.ts` | HTTP `/health` + `/ws` on `:8080` |
| `client/src/input/adapter.ts` | `InputAdapter` contract (`start`/`stop` → sign edges) |
| `client/src/input/keyboardAdapter.ts` | Keys A/S/W/D/F/G → TIGER/SNAKE/RAM/BOAR/BIRD/OX |
| `client/src/input/handTracker.ts` | MediaPipe landmarker + `classifySign` (one seal per frame) |
| `client/src/input/gestureAdapter.ts` | Hysteresis, then `down`/`up` on a playable sign |
| `client/src/ui/CameraStage.tsx` | Local preview + enable/disable |
| `client/src/net/wsClient.ts` | Typed send, queue until socket open |
| `client/src/ui/Duel.tsx` | Buffer rails, HP, pads, keyboard + camera |
| `client/src/App.tsx` | Lobby → waiting → duel → ended |

`matchBuffer` is the sequence brain. `stepFighter` is the stance brain. Do not duplicate either on the client.

## Protocol

```ts
type Sign = "TIGER" | "SNAKE" | "RAM" | "BOAR" | "BIRD" | "OX";
type Edge = "down" | "up";
type Seat = "a" | "b";
type Phase = "waiting" | "connecting" | "live" | "ended";
type Stance = "idle" | "startup" | "active" | "recover" | "block" | "hitstun";

type ClientMsg =
  | { type: "join"; code?: string; name?: string }
  | { type: "signal"; payload: unknown }          // reserved for WebRTC later
  | { type: "input"; seq: number; sign: Sign; edge: Edge; tClient: number }
  | { type: "ready" }
  | { type: "leave" };

type FighterPublic = {
  hp: number;          // 0..MAX_HP (6)
  stance: Stance;
  moveId: string | null;
  buffer: Sign[];      // recent downs, HUD telegraph
  held: Sign[];
  guardLeft: number;   // ticks of guard remaining, 0 if not blocking
};

type ServerMsg =
  | { type: "joined"; playerId: string; seat: Seat; code: string; peerPresent: boolean; name: string }
  | { type: "peer_joined"; seat: Seat; name: string }
  | { type: "peer_left"; seat: Seat }
  | { type: "signal"; from: Seat; payload: unknown }
  | { type: "state"; tick: number; a: FighterPublic; b: FighterPublic }
  | { type: "match_state"; phase: Phase; winner?: Seat | "draw" | null }
  | { type: "error"; code: string; message: string };
```

`seq` is monotonic per client. Stale seqs are dropped. `signal` is forwarded opaquely (unused until video).

## Sign alphabet

| Sign | Hand (finger up) | Keyboard |
|---|---|---|
| TIGER | middle only | A |
| SNAKE | index + middle | S |
| RAM | index + pinky | W |
| BOAR | middle + ring | D |
| BIRD | all four | F |
| OX | index + middle + pinky | G |

`UNKNOWN` and leftover classifier labels (MONKEY, HORSE, DOG, HARE) release the held sign. Move **ids** stay lowercase (`tiger`) so they do not collide with sign tokens (`TIGER`).

## Sim cookbook

Constants (all in ticks of 50ms):

| Name | Ticks | ms |
|---|---|---|
| `TICK_HZ` | 20 | 50 |
| `INPUT_DELAY_TICKS` | 2 | 100 |
| `MAX_HP` | — | 6 (tiger hits for 2) |
| tiger startup | 7 | 350 |
| serpent startup | 4 | 200 |
| ox startup | 6 | 300 |
| boar startup | 10 | 500 |
| `HITSTUN_TICKS` | 6 | 300 |
| `BUFFER_TICKS` | 24 | 1200 |
| guard duration | 40 | 2000 |

Command table (`server/src/commands.ts`):

| id | seq | kind | notes |
|---|---|---|---|
| tiger | TIGER, SNAKE, RAM | attack | dmg 2 |
| serpent | SNAKE, RAM, TIGER | attack | faster, dmg 2 |
| ox | RAM, TIGER, BOAR | attack | dmg 2 |
| boar | TIGER, BOAR, RAM | attack | slower, dmg 3 |
| crane | BIRD, OX, TIGER | attack | dmg 2 |
| hare | OX, BOAR, BIRD | attack | dmg 2 |
| dragon | BIRD, TIGER, OX | attack | slower, dmg 3 |
| guard | BOAR, SNAKE | guard | 2s window, incoming dmg `floor(n/2)` min 1, no hitstun |

Tick order inside `tickMatch`:

1. Apply pending edges whose `applyAt <= tick` (`down` first-seen goes to buffer; repeats are keepalives).
2. `stepFighter` each side:
   - prune buffer older than 1.2s
   - advance timers (`startup→active→recover→idle`, `hitstun→idle`, `block→idle` when guard expires)
   - if `idle` or `startup`, `matchBuffer`; guard may cancel startup; attacks only from idle
3. `resolveHits`: first active tick; if defender is `block`, apply reduced damage and stay in guard; else full damage + hitstun.
4. If either HP is 0 → `phase = ended`.

Worked example: A holds TIGER, SNAKE, RAM (after delay). Tiger startup ~350ms. B holds BOAR, SNAKE during that startup, enters 2s guard. Tiger connects: B loses 1 HP (half of 2) and stays guarding.

## Extension recipes

### Add a move (`SNAKE, RAM, TIGER` is already serpent)

1. Append a row to `COMMANDS` in `server/src/commands.ts` (startup/active/recover/damage, or `guardTicks` for a protect move). Longer sequences get higher `priority`.
2. Add a line to `client/src/ui/moves.ts` for the HUD hint.
3. Add tests: suffix matches, garbage-in-the-middle does not.
4. **Do not change the WebSocket schema.**

### Gesture device (already wired)

`client/src/input/gestureAdapter.ts` implements `InputAdapter`. One classified seal → one sign token. Hysteresis (4 frames) then `down`/`up`. Keyboard may run at the same time. **Do not** detect `TIGER, SNAKE, RAM` in vision. **Do not** add a `gesture` message type.

### Add webcam telegraph

1. `getUserMedia` + `RTCPeerConnection`. Seat `a` offers. Trickle ICE through existing `signal` messages.
2. Opponent video is the stage. Hide opponent `buffer` HUD behind a debug flag so people look at hands.
3. Keep sending **signs on WebSocket**. No DataChannel inputs (server must referee).
4. If ICE fails, the keyboard/gesture fight continues. Copy: “cannot reach camera (NAT). TURN not configured.”

### Change HP or stances

Edit `sim.ts` + tests, and `FighterPublic` in `packages/protocol` if the HUD needs a new field.

## What is intentionally missing

WebRTC, TURN, accounts, anti-cheat, a real jutsu catalog, audio, rollback netcode. Use the recipes above. Do not leave stub files that pretend these exist.

Signs on the wire are spoofable. This build is unranked / trusted clients.

## Tests (keep green)

| Test | Rule it locks |
|---|---|
| `TIGER SNAKE RAM suffix matches tiger` | happy path |
| `leading BOAR still matches tiger` | leading extra is ok |
| `garbage in the middle does not match tiger` | no garbage in the middle |
| `BOAR SNAKE suffix matches guard` | guard is a sequence |
| `SNAKE RAM TIGER / RAM TIGER BOAR / TIGER BOAR RAM` | extra attacks |
| `holding BOAR does not guard` | no hold-to-block |
| `BOAR SNAKE enters timed guard` | 2s window then idle |
| `BOAR SNAKE during startup cancels into guard` | reaction |
| `guard reduces damage and stays in block` | reduction, not hitstun |
| `three unblocked tigers end the match` | 2 dmg × 3 = 6 HP |

## Layers (why the code is shaped this way)

```
keyboard / pads / webcam classifier
        │
        ▼
   signs TIGER SNAKE RAM BOAR BIRD OX  ← the contract
        │  WebSocket input
        ▼
   per-player buffer + held
        │  matchBuffer()
        ▼
   move id (tiger, later others)
        │  stepFighter + resolveHits
        ▼
   stance / HP snapshots
```

Video is a parallel human telegraph. It never feeds `matchBuffer`.
