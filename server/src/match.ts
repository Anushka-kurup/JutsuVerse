import {
  CLASH_WINDOW_TICKS,
  COUNTDOWN_TICKS,
  INPUT_DELAY_TICKS,
  TICK_HZ,
  type Edge,
  type FighterPublic,
  type HoldMsg,
  type InputMsg,
  type Phase,
  type ReadyStage,
  type Seat,
  type Sign,
} from "@jutsu/protocol";
import type { SkillElement } from "../../shared/skills.ts";
import type { AttackCommand } from "./commands.ts";
import {
  applyEdge,
  applyHold,
  blockAttack,
  createFighter,
  stepFighter,
  takeDamage,
  toPublic,
  type Fighter,
} from "./sim.ts";

type PendingInput =
  | { kind: "edge"; sign: Sign; edge: Edge; applyAt: number; seq: number }
  | { kind: "hold"; sign: Sign | null; applyAt: number; seq: number };

export interface PendingAttack {
  seat: Seat;
  command: AttackCommand;
  castTick: number;
  resolveAtTick: number;
}

export interface MatchSession {
  phase: Phase;
  tick: number;
  countdownUntil: number | null;
  fighters: { a: Fighter; b: Fighter };
  pendingInput: { a: PendingInput[]; b: PendingInput[] };
  pendingAttacks: { a: PendingAttack | null; b: PendingAttack | null };
  lastSeq: { a: number; b: number };
  cam: { a: boolean; b: boolean };
  ready: { a: boolean; b: boolean };
  winner: Seat | "draw" | null;
}

const OTHER: Record<Seat, Seat> = { a: "b", b: "a" };
const BEATS: Record<SkillElement, SkillElement> = {
  FIRE: "WIND",
  WIND: "EARTH",
  EARTH: "WATER",
  WATER: "FIRE",
};

export function createMatch(): MatchSession {
  return {
    phase: "waiting",
    tick: 0,
    countdownUntil: null,
    fighters: { a: createFighter(), b: createFighter() },
    pendingInput: { a: [], b: [] },
    pendingAttacks: { a: null, b: null },
    lastSeq: { a: -1, b: -1 },
    cam: { a: false, b: false },
    ready: { a: false, b: false },
    winner: null,
  };
}

export function markReady(
  m: MatchSession,
  seat: Seat,
  stage: ReadyStage,
  enabled = true,
): MatchSession {
  if (stage === "camera") {
    if (m.phase !== "waiting" && m.phase !== "connecting") return m;
    const cam = { ...m.cam, [seat]: enabled };
    const ready = enabled ? m.ready : { ...m.ready, [seat]: false };
    return {
      ...m,
      cam,
      ready,
      phase: cam.a && cam.b ? "connecting" : "waiting",
    };
  }

  if (stage === "start") {
    if (m.phase !== "connecting") return m;
    const ready = { ...m.ready, [seat]: true };
    return ready.a && ready.b
      ? {
          ...m,
          ready,
          phase: "countdown",
          countdownUntil: m.tick + COUNTDOWN_TICKS,
        }
      : { ...m, ready };
  }

  if (m.phase !== "ended") return m;
  const ready = { ...m.ready, [seat]: true };
  if (!ready.a || !ready.b) return { ...m, ready };
  return {
    ...createMatch(),
    phase: "countdown",
    cam: { a: true, b: true },
    ready,
    countdownUntil: COUNTDOWN_TICKS,
  };
}

export function receiveInput(
  m: MatchSession,
  seat: Seat,
  msg: InputMsg | HoldMsg,
): MatchSession {
  if (m.phase !== "live" || msg.seq <= m.lastSeq[seat]) return m;
  const input: PendingInput = msg.type === "hold"
    ? { kind: "hold", sign: msg.sign, applyAt: m.tick + INPUT_DELAY_TICKS, seq: msg.seq }
    : {
        kind: "edge",
        sign: msg.sign,
        edge: msg.edge,
        applyAt: m.tick + INPUT_DELAY_TICKS,
        seq: msg.seq,
      };
  return {
    ...m,
    lastSeq: { ...m.lastSeq, [seat]: msg.seq },
    pendingInput: {
      ...m.pendingInput,
      [seat]: [...m.pendingInput[seat], input],
    },
  };
}

export function tickMatch(m: MatchSession): MatchSession {
  if (m.phase !== "countdown" && m.phase !== "live") return m;
  const tick = m.tick + 1;

  if (m.phase === "countdown") {
    return tick >= (m.countdownUntil ?? tick)
      ? { ...m, tick, phase: "live", countdownUntil: null, ready: { a: false, b: false } }
      : { ...m, tick };
  }

  const appliedA = applyInputs(m.fighters.a, m.pendingInput.a, tick);
  const appliedB = applyInputs(m.fighters.b, m.pendingInput.b, tick);
  const steppedA = stepFighter(appliedA.fighter, tick, m.pendingAttacks.a === null);
  const steppedB = stepFighter(appliedB.fighter, tick, m.pendingAttacks.b === null);

  let fighters = { a: steppedA.fighter, b: steppedB.fighter };
  let pendingAttacks = { ...m.pendingAttacks };
  if (steppedA.attack) pendingAttacks.a = pendingAttack("a", steppedA.attack, tick);
  if (steppedB.attack) pendingAttacks.b = pendingAttack("b", steppedB.attack, tick);

  if (
    pendingAttacks.a &&
    pendingAttacks.b &&
    Math.abs(pendingAttacks.a.castTick - pendingAttacks.b.castTick) <= CLASH_WINDOW_TICKS
  ) {
    fighters = resolveClash(fighters, pendingAttacks.a, pendingAttacks.b, tick);
    pendingAttacks = { a: null, b: null };
  } else {
    for (const seat of ["a", "b"] as const) {
      const attack = pendingAttacks[seat];
      if (!attack || tick < attack.resolveAtTick) continue;
      const defenderSeat = OTHER[seat];
      const defender = fighters[defenderSeat];
      fighters = {
        ...fighters,
        [defenderSeat]: defender.stance === "block"
          ? blockAttack(defender)
          : takeDamage(defender, tick, attack.command.damage, true),
      };
      pendingAttacks = { ...pendingAttacks, [seat]: null };
    }
  }

  let phase: Phase = "live";
  let winner: Seat | "draw" | null = null;
  if (fighters.a.hp <= 0 || fighters.b.hp <= 0) {
    phase = "ended";
    winner = fighters.a.hp <= 0 && fighters.b.hp <= 0
      ? "draw"
      : fighters.a.hp <= 0 ? "b" : "a";
  }

  return {
    ...m,
    tick,
    phase,
    winner,
    fighters,
    pendingAttacks,
    pendingInput: { a: appliedA.rest, b: appliedB.rest },
  };
}

function applyInputs(fighter: Fighter, inputs: PendingInput[], tick: number) {
  const due = inputs.filter((input) => input.applyAt <= tick);
  const rest = inputs.filter((input) => input.applyAt > tick);
  let next = fighter;
  for (const input of due) {
    next = input.kind === "hold"
      ? applyHold(next, input.sign)
      : applyEdge(next, input.sign, input.edge, tick);
  }
  return { fighter: next, rest };
}

function pendingAttack(seat: Seat, command: AttackCommand, tick: number): PendingAttack {
  return { seat, command, castTick: tick, resolveAtTick: tick + CLASH_WINDOW_TICKS };
}

function resolveClash(
  fighters: { a: Fighter; b: Fighter },
  a: PendingAttack,
  b: PendingAttack,
  tick: number,
): { a: Fighter; b: Fighter } {
  if (BEATS[a.command.element] === b.command.element) {
    return { ...fighters, b: takeDamage(fighters.b, tick, a.command.damage) };
  }
  if (BEATS[b.command.element] === a.command.element) {
    return { ...fighters, a: takeDamage(fighters.a, tick, b.command.damage) };
  }
  return {
    a: takeDamage(fighters.a, tick, b.command.damage),
    b: takeDamage(fighters.b, tick, a.command.damage),
  };
}

export function countdownValue(m: MatchSession): number | null {
  if (m.phase !== "countdown" || m.countdownUntil === null) return null;
  const seconds = Math.ceil((m.countdownUntil - m.tick) / TICK_HZ) - 1;
  return Math.max(0, Math.min(3, seconds));
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
