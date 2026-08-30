import {
  CLASH_WINDOW_TICKS,
  INPUT_DELAY_TICKS,
  MAX_HP,
  MEME_BANNER_TICKS,
  MEME_GATE_BONUS_HP,
  MEME_GATE_MAX_TICKS,
  MEME_RACE_HEAL,
  MEME_RACE_MAX_TICKS,
  MEME_RACE_TRIGGER_ATTACKS,
  SPECIAL_BANNER_TICKS,
  SPECIAL_DAMAGE,
  SPECIAL_MAX_TICKS,
  SPECIAL_TARGET_REPS,
  SPECIAL_TRIGGER_ATTACKS,
  type Edge,
  type FighterPublic,
  type HoldMsg,
  type InputMsg,
  type MemeChallengePublic,
  type MemeMsg,
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
import { MEME_LABELS, memeImagePath, pickMemeLabel } from "./memeLabels.ts";
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
  /** HP actually taken off the loser; 0 on a draw */
  damage: number;
  /** set on resolve; the banner rides along in "live" for SPECIAL_BANNER_TICKS */
  resolvedAtTick: number | null;
}

/**
 * A meme-gesture challenge: a random label from labels.csv, first seat to perform
 * any trained gesture wins. Used for both memegate (starts the match) and the
 * recurring memerace (a mid-battle heal round) — they never run at once, so one
 * field covers both.
 */
export interface MemeChallenge {
  label: string;
  startTick: number;
  /** hard cap — memegate then just starts the match, memerace resolves as a draw */
  endTick: number;
  doneAtTick: { a: number | null; b: number | null };
  winner: Seat | "draw" | null;
  /** HP actually restored; 0 for memegate, and 0 if the winner was already full */
  healed: number;
  /** set on resolve; the banner rides along in "live" for MEME_BANNER_TICKS */
  resolvedAtTick: number | null;
}

export interface MatchSession {
  phase: Phase;
  tick: number;
  fighters: { a: Fighter; b: Fighter };
  pendingInput: { a: PendingInput[]; b: PendingInput[] };
  pendingAttacks: { a: PendingAttack | null; b: PendingAttack | null };
  lastSeq: { a: number; b: number };
  /** casts by BOTH fighters since the last 6-7 contest — at the trigger, it starts */
  attacks: number;
  /** casts by BOTH fighters since the last meme race (or 6-7 contest, which
   * resets this too so the race yields that slot) — at the trigger, a race starts */
  castsSinceMemeRace: number;
  special: SpecialContest | null;
  memeChallenge: MemeChallenge | null;
  cam: { a: boolean; b: boolean };
  ready: { a: boolean; b: boolean };
  winner: Seat | "draw" | null;
}

const OTHER: Record<Seat, Seat> = { a: "b", b: "a" };
const BEATS: Record<SkillElement, SkillElement> = {
  WATER: "FIRE",
  FIRE: "EARTH",
  EARTH: "WATER",
};

export function createMatch(): MatchSession {
  return {
    phase: "waiting",
    tick: 0,
    fighters: { a: createFighter(), b: createFighter() },
    pendingInput: { a: [], b: [] },
    pendingAttacks: { a: null, b: null },
    lastSeq: { a: -1, b: -1 },
    attacks: 0,
    castsSinceMemeRace: 0,
    special: null,
    memeChallenge: null,
    cam: { a: false, b: false },
    ready: { a: false, b: false },
    winner: null,
  };
}

function freshMemeChallenge(tick: number, maxTicks: number): MemeChallenge {
  return {
    label: pickMemeLabel(),
    startTick: tick,
    endTick: tick + maxTicks,
    doneAtTick: { a: null, b: null },
    winner: null,
    healed: 0,
    resolvedAtTick: null,
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
          phase: "memegate",
          memeChallenge: freshMemeChallenge(m.tick, MEME_GATE_MAX_TICKS),
        }
      : { ...m, ready };
  }

  if (m.phase !== "ended") return m;
  const ready = { ...m.ready, [seat]: true };
  if (!ready.a || !ready.b) return { ...m, ready };
  return {
    ...createMatch(),
    phase: "memegate",
    cam: { a: true, b: true },
    ready,
    memeChallenge: freshMemeChallenge(0, MEME_GATE_MAX_TICKS),
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

/**
 * A confirmed meme gesture. Applies during memegate (first to perform ANY
 * trained gesture starts the match and begins with MEME_GATE_BONUS_HP extra HP,
 * 35 vs 30) and during a memerace (first to perform ANY trained gesture heals
 * MEME_RACE_HEAL). Ignored otherwise, if the label isn't a trained gesture, if
 * the challenge has already resolved, or if this seat already reported one for
 * the current attempt. If a memegate's countdown expires first the match just
 * starts, both fighters on the usual MAX_HP (see tickMemeGate).
 *
 * Deliberately doesn't require matching the challenge's shown label: with this
 * dataset, per-label detection reliability varies a lot (some gestures classify
 * readily, others rarely clear the confidence bar client-side), so requiring
 * the ONE label that happened to be picked would make it effectively unwinnable
 * whenever that pick is a weak one. The label the client reports still has to
 * be a real trained gesture, though — the MemeMsg schema only constrains it to
 * a non-empty string, so this is the actual guard against an arbitrary/bogus
 * value winning instantly.
 */
export function receiveMeme(m: MatchSession, seat: Seat, msg: MemeMsg): MatchSession {
  if (msg.seq <= m.lastSeq[seat]) return m;
  const lastSeq = { ...m.lastSeq, [seat]: msg.seq };

  const mc = m.memeChallenge;
  if (!mc || mc.winner !== null || !MEME_LABELS.includes(msg.label) || mc.doneAtTick[seat] !== null) {
    return { ...m, lastSeq };
  }
  const doneAtTick = { ...mc.doneAtTick, [seat]: m.tick };

  if (m.phase === "memegate") {
    // first to perform it starts the match with bonus HP — no lead-in
    return {
      ...m,
      lastSeq,
      phase: "live",
      memeChallenge: null,
      fighters: {
        ...m.fighters,
        [seat]: { ...m.fighters[seat], hp: MAX_HP + MEME_GATE_BONUS_HP },
      },
    };
  }
  if (m.phase === "memerace") {
    // show what actually won, not the original (now-irrelevant) suggestion
    return resolveMemeRace(
      { ...m, lastSeq, memeChallenge: { ...mc, label: msg.label, doneAtTick } },
      m.tick,
      seat,
    );
  }
  return { ...m, lastSeq };
}

export function tickMatch(m: MatchSession): MatchSession {
  if (
    m.phase !== "memegate" &&
    m.phase !== "live" &&
    m.phase !== "special" &&
    m.phase !== "memerace"
  ) {
    return m;
  }
  const tick = m.tick + 1;

  if (m.phase === "memegate") return tickMemeGate(m, tick);
  if (m.phase === "special") return tickSpecial(m, tick);
  if (m.phase === "memerace") return tickMemeRace(m, tick);

  const appliedA = applyInputs(m.fighters.a, m.pendingInput.a, tick);
  const appliedB = applyInputs(m.fighters.b, m.pendingInput.b, tick);
  const steppedA = stepFighter(appliedA.fighter, tick, m.pendingAttacks.a === null);
  const steppedB = stepFighter(appliedB.fighter, tick, m.pendingAttacks.b === null);

  let fighters = { a: steppedA.fighter, b: steppedB.fighter };
  let pendingAttacks = { ...m.pendingAttacks };
  let attacks = m.attacks;
  let castsSinceMemeRace = m.castsSinceMemeRace;
  if (steppedA.attack) {
    pendingAttacks.a = pendingAttack("a", steppedA.attack, tick);
    attacks++;
    castsSinceMemeRace++;
  }
  if (steppedB.attack) {
    pendingAttacks.b = pendingAttack("b", steppedB.attack, tick);
    attacks++;
    castsSinceMemeRace++;
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
    castsSinceMemeRace,
    special: decayBanner(m.special, tick),
    memeChallenge: decayMemeBanner(m.memeChallenge, tick),
    pendingInput: { a: appliedA.rest, b: appliedB.rest },
  };

  // Wait for the triggering attack to actually land before freezing combat —
  // entering with one in flight would silently swallow its damage.
  const settled = !pendingAttacks.a && !pendingAttacks.b;
  // 6-7 wins a tie: it's checked first, and enterSpecial also resets
  // castsSinceMemeRace so the meme race yields that cast slot.
  if (phase === "live" && attacks >= SPECIAL_TRIGGER_ATTACKS && settled) {
    return enterSpecial(next, tick);
  }
  if (phase === "live" && castsSinceMemeRace >= MEME_RACE_TRIGGER_ATTACKS && settled) {
    return enterMemeRace(next, tick);
  }
  return next;
}

/** Runs the pre-match countdown. One label, shown once, never re-rolled. When
 * a player performs the gesture the match starts synchronously in receiveMeme
 * (with bonus HP); this only runs the clock and, on expiry, starts the match
 * with nobody getting the bonus. */
function tickMemeGate(m: MatchSession, tick: number): MatchSession {
  if (!m.memeChallenge || tick >= m.memeChallenge.endTick) {
    return { ...m, tick, phase: "live", memeChallenge: null };
  }
  return { ...m, tick };
}

/** Runs a meme race's clock; a timeout resolves as a no-op draw. The race
 * itself resolves synchronously in receiveMeme when a gesture lands. */
function tickMemeRace(m: MatchSession, tick: number): MatchSession {
  const mc = m.memeChallenge;
  if (!mc) return { ...m, tick, phase: "live" };
  if (tick >= mc.endTick) return resolveMemeRace({ ...m, tick }, tick, "draw");
  return { ...m, tick };
}

/** Freeze combat and open a meme race. Seals in progress are dropped, HP is kept.
 * Recurring: castsSinceMemeRace resets to 0 and counts back up. */
function enterMemeRace(m: MatchSession, tick: number): MatchSession {
  return {
    ...m,
    phase: "memerace",
    castsSinceMemeRace: 0,
    pendingInput: { a: [], b: [] },
    pendingAttacks: { a: null, b: null },
    fighters: { a: calmFighter(m.fighters.a), b: calmFighter(m.fighters.b) },
    memeChallenge: freshMemeChallenge(tick, MEME_RACE_MAX_TICKS),
  };
}

function resolveMemeRace(m: MatchSession, tick: number, winner: Seat | "draw"): MatchSession {
  const mc = m.memeChallenge!;
  let fighters = m.fighters;
  let healed = 0;
  if (winner !== "draw") {
    const healedFighter = heal(fighters[winner], MEME_RACE_HEAL);
    healed = healedFighter.hp - fighters[winner].hp; // 0 if already at full HP
    fighters = { ...fighters, [winner]: healedFighter };
  }
  return {
    ...m,
    tick,
    phase: "live",
    fighters,
    memeChallenge: { ...mc, winner, healed, resolvedAtTick: tick },
  };
}

/** Keep the result on the wire briefly so both clients can show the banner. */
function decayMemeBanner(mc: MemeChallenge | null, tick: number): MemeChallenge | null {
  if (!mc || mc.resolvedAtTick === null) return mc;
  return tick - mc.resolvedAtTick >= MEME_BANNER_TICKS ? null : mc;
}

/** Freeze combat and open the contest. Seals in progress are dropped, HP is kept.
 * Also resets castsSinceMemeRace so the meme race yields this cast slot to 6-7. */
function enterSpecial(m: MatchSession, tick: number): MatchSession {
  return {
    ...m,
    phase: "special",
    attacks: 0,
    castsSinceMemeRace: 0,
    pendingInput: { a: [], b: [] },
    pendingAttacks: { a: null, b: null },
    fighters: { a: calmFighter(m.fighters.a), b: calmFighter(m.fighters.b) },
    special: {
      startTick: tick,
      endTick: tick + SPECIAL_MAX_TICKS,
      reps: { a: 0, b: 0 },
      winner: null,
      damage: 0,
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
  let damage = 0;
  let phase: Phase = "live";
  let matchWinner = m.winner;

  if (winner !== "draw") {
    // The prize is damage to the loser, not a heal for the winner, so unlike
    // every other contest outcome this one can end the match outright.
    const loserSeat = OTHER[winner];
    const before = fighters[loserSeat].hp;
    const loser = takeDamage(fighters[loserSeat], tick, SPECIAL_DAMAGE, true);
    damage = before - loser.hp; // short of the full hit when it downed them
    fighters = { ...fighters, [loserSeat]: loser };
    if (loser.hp <= 0) {
      phase = "ended";
      matchWinner = winner;
    }
  }

  return {
    ...m,
    tick,
    phase,
    winner: matchWinner,
    fighters,
    special: { ...sp, winner, damage, resolvedAtTick: tick },
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

export function specialPublic(m: MatchSession): SpecialPublic | undefined {
  const sp = m.special;
  if (!sp) return undefined;
  return {
    reps: sp.reps,
    target: SPECIAL_TARGET_REPS,
    ticksLeft: sp.winner === null ? Math.max(0, sp.endTick - m.tick) : 0,
    winner: sp.winner,
    damage: sp.damage,
  };
}

export function memeChallengePublic(m: MatchSession): MemeChallengePublic | undefined {
  const mc = m.memeChallenge;
  if (!mc) return undefined;
  return {
    label: mc.label,
    image: memeImagePath(mc.label),
    ticksLeft: mc.winner === null ? Math.max(0, mc.endTick - m.tick) : 0,
    done: { a: mc.doneAtTick.a !== null, b: mc.doneAtTick.b !== null },
    winner: mc.winner,
    healed: mc.healed,
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
    special: specialPublic(m),
    memeChallenge: memeChallengePublic(m),
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
