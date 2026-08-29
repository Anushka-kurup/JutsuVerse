import {
  CLASH_WINDOW_TICKS,
  COUNTDOWN_TICKS,
  INPUT_DELAY_TICKS,
  SPECIAL_BANNER_TICKS,
  SPECIAL_HEAL,
  SPECIAL_MAX_TICKS,
  SPECIAL_TARGET_REPS,
  SPECIAL_TRIGGER_ATTACKS,
  TICK_HZ,
  type Edge,
  type FighterPublic,
  type HoldMsg,
  type InputMsg,
  type Phase,
  type ReadyStage,
  type RepsMsg,
  type Seat,
  type ServerMsg,
  type Sign,
  type SpecialPublic,
} from "@jutsu/protocol";
import type { SkillElement } from "../../shared/skills.ts";
import type { AttackCommand } from "./commands.ts";
import {
  applyEdge,
  applyHold,
  blockAttack,
  calmFighter,
  createFighter,
  heal,
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

/**
 * The 6-7 rep contest. Combat is frozen while this runs: both players perform
 * the gesture on camera and report their own counts (`receiveReps`), and the
 * first to SPECIAL_TARGET_REPS heals. The clients detect, the server arbitrates.
 */
export interface SpecialContest {
  startTick: number;
  /** hard cap — whoever leads when this passes wins, so a dead camera can't hang the match */
  endTick: number;
  reps: { a: number; b: number };
  /** null while running */
  winner: Seat | "draw" | null;
  /** HP actually restored; 0 if the winner was already at full health */
  healed: number;
  /** set on resolve; the banner rides along in "live" for SPECIAL_BANNER_TICKS */
  resolvedAtTick: number | null;
}

export interface MatchSession {
  phase: Phase;
  tick: number;
  countdownUntil: number | null;
  fighters: { a: Fighter; b: Fighter };
  pendingInput: { a: PendingInput[]; b: PendingInput[] };
  pendingAttacks: { a: PendingAttack | null; b: PendingAttack | null };
  lastSeq: { a: number; b: number };
  /** casts by BOTH fighters since the last contest — at the trigger, the contest starts */
  attacks: number;
  special: SpecialContest | null;
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
    attacks: 0,
    special: null,
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

/**
 * A client's own rep count during the contest. Clamped to monotonic growth so a
 * client can only ever push its number forward, never walk it back.
 */
export function receiveReps(m: MatchSession, seat: Seat, msg: RepsMsg): MatchSession {
  if (m.phase !== "special" || !m.special || m.special.winner !== null) return m;
  if (msg.seq <= m.lastSeq[seat]) return m;
  const reps = Math.max(m.special.reps[seat], msg.reps);
  return {
    ...m,
    lastSeq: { ...m.lastSeq, [seat]: msg.seq },
    special: { ...m.special, reps: { ...m.special.reps, [seat]: reps } },
  };
}

export function tickMatch(m: MatchSession): MatchSession {
  if (m.phase !== "countdown" && m.phase !== "live" && m.phase !== "special") return m;
  const tick = m.tick + 1;

  if (m.phase === "countdown") {
    return tick >= (m.countdownUntil ?? tick)
      ? { ...m, tick, phase: "live", countdownUntil: null, ready: { a: false, b: false } }
      : { ...m, tick };
  }

  if (m.phase === "special") return tickSpecial(m, tick);

  const appliedA = applyInputs(m.fighters.a, m.pendingInput.a, tick);
  const appliedB = applyInputs(m.fighters.b, m.pendingInput.b, tick);
  const steppedA = stepFighter(appliedA.fighter, tick, m.pendingAttacks.a === null);
  const steppedB = stepFighter(appliedB.fighter, tick, m.pendingAttacks.b === null);

  let fighters = { a: steppedA.fighter, b: steppedB.fighter };
  let pendingAttacks = { ...m.pendingAttacks };
  let attacks = m.attacks;
  if (steppedA.attack) {
    pendingAttacks.a = pendingAttack("a", steppedA.attack, tick);
    attacks++;
  }
  if (steppedB.attack) {
    pendingAttacks.b = pendingAttack("b", steppedB.attack, tick);
    attacks++;
  }

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

  const next: MatchSession = {
    ...m,
    tick,
    phase,
    winner,
    fighters,
    pendingAttacks,
    attacks,
    special: decayBanner(m.special, tick),
    pendingInput: { a: appliedA.rest, b: appliedB.rest },
  };

  // Wait for the triggering attack to actually land before freezing combat —
  // entering with one in flight would silently swallow its damage.
  const settled = !pendingAttacks.a && !pendingAttacks.b;
  if (phase === "live" && attacks >= SPECIAL_TRIGGER_ATTACKS && settled) {
    return enterSpecial(next, tick);
  }
  return next;
}

/** Freeze combat and open the contest. Seals in progress are dropped, HP is kept. */
function enterSpecial(m: MatchSession, tick: number): MatchSession {
  return {
    ...m,
    phase: "special",
    attacks: 0,
    pendingInput: { a: [], b: [] },
    pendingAttacks: { a: null, b: null },
    fighters: { a: calmFighter(m.fighters.a), b: calmFighter(m.fighters.b) },
    special: {
      startTick: tick,
      endTick: tick + SPECIAL_MAX_TICKS,
      reps: { a: 0, b: 0 },
      winner: null,
      healed: 0,
      resolvedAtTick: null,
    },
  };
}

function tickSpecial(m: MatchSession, tick: number): MatchSession {
  const sp = m.special;
  if (!sp) return { ...m, tick, phase: "live" };

  const reachedA = sp.reps.a >= SPECIAL_TARGET_REPS;
  const reachedB = sp.reps.b >= SPECIAL_TARGET_REPS;
  if (reachedA || reachedB) {
    // both can cross inside one tick — the bigger count takes it
    const winner = reachedA && reachedB ? leader(sp.reps) : reachedA ? "a" : "b";
    return resolveSpecial(m, tick, winner);
  }
  if (tick >= sp.endTick) return resolveSpecial(m, tick, leader(sp.reps));
  return { ...m, tick };
}

function leader(reps: { a: number; b: number }): Seat | "draw" {
  if (reps.a === reps.b) return "draw";
  return reps.a > reps.b ? "a" : "b";
}

function resolveSpecial(
  m: MatchSession,
  tick: number,
  winner: Seat | "draw",
): MatchSession {
  const sp = m.special!;
  let fighters = m.fighters;
  let healed = 0;
  if (winner !== "draw") {
    const healedFighter = heal(fighters[winner], SPECIAL_HEAL);
    healed = healedFighter.hp - fighters[winner].hp; // 0 if already at full HP
    fighters = { ...fighters, [winner]: healedFighter };
  }
  return {
    ...m,
    tick,
    phase: "live",
    fighters,
    special: { ...sp, winner, healed, resolvedAtTick: tick },
  };
}

/** Keep the result on the wire briefly so both clients can show the banner. */
function decayBanner(sp: SpecialContest | null, tick: number): SpecialContest | null {
  if (!sp || sp.resolvedAtTick === null) return sp;
  return tick - sp.resolvedAtTick >= SPECIAL_BANNER_TICKS ? null : sp;
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

export function specialPublic(m: MatchSession): SpecialPublic | undefined {
  const sp = m.special;
  if (!sp) return undefined;
  return {
    reps: sp.reps,
    target: SPECIAL_TARGET_REPS,
    ticksLeft: sp.winner === null ? Math.max(0, sp.endTick - m.tick) : 0,
    winner: sp.winner,
    healed: sp.healed,
  };
}

/** The one place a match_state frame is built — the hub and the loop both use it. */
export function matchStatePublic(m: MatchSession): Extract<ServerMsg, { type: "match_state" }> {
  return {
    type: "match_state",
    phase: m.phase,
    winner: m.winner,
    cam: m.cam,
    ready: m.ready,
    countdown: countdownValue(m),
    special: specialPublic(m),
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
