import {
  INPUT_DELAY_TICKS,
  type Edge,
  type FighterPublic,
  type InputMsg,
  type Phase,
  type ReadyStage,
  type Seat,
  type Sign,
} from "@jutsu/protocol";
import {
  applyEdge,
  createFighter,
  resolveHits,
  stepFighter,
  toPublic,
  type Fighter,
} from "./sim.ts";

export interface PendingEdge {
  sign: Sign;
  edge: Edge;
  applyAt: number;
  seq: number;
}

export interface MatchSession {
  phase: Phase;
  tick: number;
  fighters: { a: Fighter; b: Fighter };
  pending: { a: PendingEdge[]; b: PendingEdge[] };
  lastSeq: { a: number; b: number };
  /** stage 1 gate: both cameras enabled → phase "connecting" */
  cam: { a: boolean; b: boolean };
  /** stage 2 gate: both pressed Start → phase "live" */
  ready: { a: boolean; b: boolean };
  winner: Seat | "draw" | null;
}

export function createMatch(): MatchSession {
  return {
    phase: "waiting",
    tick: 0,
    fighters: { a: createFighter(), b: createFighter() },
    pending: { a: [], b: [] },
    lastSeq: { a: -1, b: -1 },
    cam: { a: false, b: false },
    ready: { a: false, b: false },
    winner: null,
  };
}

export function markReady(
  m: MatchSession,
  seat: Seat,
  stage: ReadyStage = "camera",
): MatchSession {
  if (stage === "camera") {
    if (m.phase !== "waiting") return m;
    const cam = { ...m.cam, [seat]: true };
    return { ...m, cam, phase: cam.a && cam.b ? "connecting" : "waiting" };
  }
  if (m.phase !== "connecting") return m;
  const ready = { ...m.ready, [seat]: true };
  return { ...m, ready, phase: ready.a && ready.b ? "live" : "connecting" };
}

/** rematch: cameras stay on, but both players press Start again */
export function restartMatch(camSeats: Iterable<Seat>): MatchSession {
  let match = createMatch();
  for (const seat of camSeats) match = markReady(match, seat, "camera");
  return match;
}

export function receiveInput(
  m: MatchSession,
  seat: Seat,
  msg: InputMsg,
): MatchSession {
  if (m.phase !== "live") return m;
  if (msg.seq <= m.lastSeq[seat]) return m;
  const edge: PendingEdge = {
    sign: msg.sign,
    edge: msg.edge,
    applyAt: m.tick + INPUT_DELAY_TICKS,
    seq: msg.seq,
  };
  return {
    ...m,
    lastSeq: { ...m.lastSeq, [seat]: msg.seq },
    pending: {
      ...m.pending,
      [seat]: [...m.pending[seat], edge],
    },
  };
}

export function tickMatch(m: MatchSession): MatchSession {
  if (m.phase !== "live") return m;
  const tick = m.tick + 1;

  const applyDue = (seat: Seat, f: Fighter) => {
    const due = m.pending[seat].filter((p) => p.applyAt <= tick);
    const rest = m.pending[seat].filter((p) => p.applyAt > tick);
    let next = f;
    for (const e of due) next = applyEdge(next, e.sign, e.edge, tick);
    return { next, rest };
  };

  const aApp = applyDue("a", m.fighters.a);
  const bApp = applyDue("b", m.fighters.b);
  let a = stepFighter(aApp.next, tick);
  let b = stepFighter(bApp.next, tick);
  const hits = resolveHits(a, b, tick);
  a = hits.a;
  b = hits.b;

  let phase: Phase = m.phase;
  let winner = m.winner;
  if (a.hp <= 0 || b.hp <= 0) {
    phase = "ended";
    if (a.hp <= 0 && b.hp <= 0) winner = "draw";
    else if (a.hp <= 0) winner = "b";
    else winner = "a";
  }

  return {
    ...m,
    tick,
    phase,
    winner,
    fighters: { a, b },
    pending: { a: aApp.rest, b: bApp.rest },
  };
}

export function publicState(m: MatchSession): {
  tick: number;
  a: FighterPublic;
  b: FighterPublic;
} {
  return {
    tick: m.tick,
    a: toPublic(m.fighters.a, m.tick),
    b: toPublic(m.fighters.b, m.tick),
  };
}
