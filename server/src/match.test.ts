import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTDOWN_TICKS,
  MAX_HP,
  MAX_SHIELDS,
  SPECIAL_HEAL,
  SPECIAL_TARGET_REPS,
  SPECIAL_TRIGGER_ATTACKS,
  type Seat,
} from "@jutsu/protocol";
import { ATTACKS, attackById } from "./commands.ts";
import {
  countdownValue,
  createMatch,
  markReady,
  receiveReps,
  specialPublic,
  tickMatch,
  type MatchSession,
  type PendingAttack,
  type SpecialContest,
} from "./match.ts";
import { applyEdge, applyHold, stepFighter } from "./sim.ts";

function liveMatch(): MatchSession {
  return { ...createMatch(), phase: "live" };
}

function pending(
  seat: "a" | "b",
  id: string,
  castTick = 0,
  resolveAtTick = 20,
): PendingAttack {
  return {
    seat,
    command: attackById(id)!,
    castTick,
    resolveAtTick,
  };
}

/** Seed a finished seal sequence so the next tick casts it. Level 3 fires immediately. */
function seedCast(m: MatchSession, seat: Seat, id: string): void {
  const command = attackById(id)!;
  m.fighters[seat] = {
    ...m.fighters[seat],
    buffer: command.seq.map((sign, index) => ({ sign, tick: index })),
  };
}

function contestMatch(
  reps: { a: number; b: number },
  over: Partial<SpecialContest> = {},
): MatchSession {
  const m = liveMatch();
  return {
    ...m,
    phase: "special",
    special: {
      startTick: 0,
      endTick: 10_000,
      reps,
      winner: null,
      healed: 0,
      resolvedAtTick: null,
      ...over,
    },
  };
}

function repsMsg(seq: number, reps: number) {
  return { type: "reps" as const, seq, reps, tClient: 0 };
}

test("defines all elemental levels with the requested damage", () => {
  assert.equal(ATTACKS.length, 12);
  const bases = {
    fire: ["rat", "ox", "tiger"],
    wind: ["hare", "dragon", "snake"],
    earth: ["horse", "ram", "monkey"],
    water: ["bird", "dog", "boar"],
  } as const;
  for (const element of ["fire", "wind", "earth", "water"] as const) {
    assert.equal(attackById(`${element}_1`)?.damage, 1);
    assert.equal(attackById(`${element}_2`)?.damage, 2);
    assert.equal(attackById(`${element}_3`)?.damage, 4);
    assert.equal(attackById(`${element}_1`)?.seq.length, 3);
    assert.equal(attackById(`${element}_2`)?.seq.length, 4);
    assert.equal(attackById(`${element}_3`)?.seq.length, 5);
    assert.deepEqual(attackById(`${element}_1`)?.seq, bases[element]);
    assert.deepEqual(attackById(`${element}_2`)?.seq, [...bases[element], "mizunoe"]);
    assert.deepEqual(attackById(`${element}_3`)?.seq, [
      ...bases[element],
      "mizunoe",
      "gassho",
    ]);
  }
});

test("elemental counter wins a clash regardless of level", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_1"),
    b: pending("b", "wind_3"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP);
  assert.equal(next.fighters.b.hp, MAX_HP - 15);
  assert.deepEqual(next.pendingAttacks, { a: null, b: null });
});

test("opposite elements use the base-damage difference", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_1"),
    b: pending("b", "earth_3"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP - 3);
  assert.equal(next.fighters.b.hp, MAX_HP);
});

test("equal-level non-countering attacks deal no damage", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_2"),
    b: pending("b", "earth_2"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP);
  assert.equal(next.fighters.b.hp, MAX_HP);
});

test("one-second clash window is inclusive and rejects later attacks", () => {
  const inside = { ...liveMatch(), tick: 19 };
  inside.pendingAttacks = {
    a: pending("a", "fire_1", 0, 20),
    b: pending("b", "wind_1", 20, 40),
  };
  const clashed = tickMatch(inside);
  assert.equal(clashed.fighters.b.hp, MAX_HP - 15);

  const outside = { ...liveMatch(), tick: 19 };
  outside.pendingAttacks = {
    a: pending("a", "fire_1", 0, 20),
    b: pending("b", "wind_1", 21, 41),
  };
  const unopposed = tickMatch(outside);
  assert.equal(unopposed.fighters.b.hp, MAX_HP - 1);
  assert.notEqual(unopposed.pendingAttacks.b, null);
});

test("unopposed attack deals base damage and clears defender preparation", () => {
  const m = { ...liveMatch(), tick: 19 };
  m.fighters.b.buffer = [{ sign: "rat", tick: 10 }];
  m.pendingAttacks.a = pending("a", "fire_1");
  const next = tickMatch(m);
  assert.equal(next.fighters.b.hp, MAX_HP - 1);
  assert.deepEqual(next.fighters.b.buffer, []);
});

test("maintained shield blocks all damage and consumes one shield", () => {
  const m = { ...liveMatch(), tick: 19 };
  m.fighters.b = {
    ...m.fighters.b,
    stance: "block",
    moveId: "shield",
    currentHold: "mizunoe",
    shieldUntilTick: 60,
  };
  m.pendingAttacks.a = pending("a", "fire_3");
  const next = tickMatch(m);
  assert.equal(next.fighters.b.hp, MAX_HP);
  assert.equal(next.fighters.b.shields, MAX_SHIELDS - 1);
  assert.equal(next.fighters.b.stance, "idle");
});

test("shield sequence is 13 then 12 and requires sign 12 to remain held", () => {
  let fighter = applyHold(createMatch().fighters.a, "mizunoe");
  fighter = applyEdge(fighter, "gassho", "down", 1);
  fighter = applyEdge(fighter, "mizunoe", "down", 2);
  const active = stepFighter(fighter, 2).fighter;
  assert.equal(active.stance, "block");

  const released = stepFighter(applyHold(active, null), 3).fighter;
  assert.equal(released.stance, "idle");
  assert.equal(released.shields, MAX_SHIELDS);

  const expired = stepFighter({ ...active, shieldUntilTick: 3 }, 3).fighter;
  assert.equal(expired.stance, "idle");
});

test("seal buffer ignores consecutive duplicates and stores at most five", () => {
  let fighter = createMatch().fighters.a;
  fighter = applyEdge(fighter, "rat", "down", 1);
  fighter = applyEdge(fighter, "rat", "down", 2);
  assert.deepEqual(fighter.buffer.map((event) => event.sign), ["rat"]);

  for (const [index, sign] of [
    "ox",
    "tiger",
    "hare",
    "dragon",
    "snake",
  ].entries()) {
    fighter = applyEdge(fighter, sign as Parameters<typeof applyEdge>[1], "down", index + 3);
  }
  assert.deepEqual(fighter.buffer.map((event) => event.sign), [
    "ox",
    "tiger",
    "hare",
    "dragon",
    "snake",
  ]);
});

test("server owns 3, 2, 1, 0 countdown", () => {
  let m = createMatch();
  m = markReady(m, "a", "camera");
  m = markReady(m, "b", "camera");
  m = markReady(m, "a", "start");
  m = markReady(m, "b", "start");
  assert.equal(m.phase, "countdown");
  assert.equal(countdownValue(m), 3);

  for (let i = 0; i < COUNTDOWN_TICKS; i++) m = tickMatch(m);
  assert.equal(m.phase, "live");
});

test("rematch resets only after both players are ready", () => {
  let m: MatchSession = { ...createMatch(), phase: "ended", winner: "a" };
  m.fighters.a.hp = 7;
  m.fighters.a.shields = 0;
  m = markReady(m, "a", "rematch");
  assert.equal(m.phase, "ended");
  m = markReady(m, "b", "rematch");
  assert.equal(m.phase, "countdown");
  assert.equal(m.fighters.a.hp, MAX_HP);
  assert.equal(m.fighters.a.shields, MAX_SHIELDS);
});

// ── 6-7 special contest ─────────────────────────────────────────────

test("five combined casts open the contest, once the last attack has landed", () => {
  let m = liveMatch();
  m.attacks = SPECIAL_TRIGGER_ATTACKS - 1;
  seedCast(m, "a", "fire_3");

  m = tickMatch(m);
  assert.equal(m.attacks, SPECIAL_TRIGGER_ATTACKS);
  // still live: the triggering attack is in flight and must be allowed to land
  assert.equal(m.phase, "live");
  assert.notEqual(m.pendingAttacks.a, null);

  for (let i = 0; i < 40 && m.phase === "live"; i++) m = tickMatch(m);
  assert.equal(m.phase, "special");
  assert.equal(m.fighters.b.hp, MAX_HP - 4, "the fifth attack still deals its damage");
  assert.deepEqual(m.special?.reps, { a: 0, b: 0 });
  assert.equal(m.attacks, 0, "the counter re-arms for the next contest");
});

test("a lethal fifth attack ends the match instead of opening the contest", () => {
  let m = liveMatch();
  m.attacks = SPECIAL_TRIGGER_ATTACKS - 1;
  m.fighters.b = { ...m.fighters.b, hp: 2 };
  seedCast(m, "a", "fire_3");

  for (let i = 0; i < 40 && m.phase === "live"; i++) m = tickMatch(m);
  assert.equal(m.phase, "ended");
  assert.equal(m.winner, "a");
});

test("entering the contest drops seals in progress but keeps HP and shields", () => {
  let m = liveMatch();
  m.attacks = SPECIAL_TRIGGER_ATTACKS;
  m.fighters.b = {
    ...m.fighters.b,
    hp: 12,
    shields: 1,
    buffer: [{ sign: "rat", tick: 0 }],
    currentHold: "rat",
  };
  m = tickMatch(m);
  assert.equal(m.phase, "special");
  assert.equal(m.fighters.b.hp, 12);
  assert.equal(m.fighters.b.shields, 1);
  assert.deepEqual(m.fighters.b.buffer, []);
  assert.equal(m.fighters.b.currentHold, null);
});

test("first to the target heals and combat resumes", () => {
  const m = contestMatch({ a: SPECIAL_TARGET_REPS, b: 40 });
  m.fighters.a = { ...m.fighters.a, hp: 5 };
  const next = tickMatch(m);
  assert.equal(next.phase, "live");
  assert.equal(next.special?.winner, "a");
  assert.equal(next.special?.healed, SPECIAL_HEAL);
  assert.equal(next.fighters.a.hp, 5 + SPECIAL_HEAL);
  assert.equal(next.fighters.b.hp, MAX_HP);
});

test("winning at full health heals nothing", () => {
  const m = contestMatch({ a: SPECIAL_TARGET_REPS, b: 0 });
  const next = tickMatch(m);
  assert.equal(next.special?.winner, "a");
  assert.equal(next.special?.healed, 0);
  assert.equal(next.fighters.a.hp, MAX_HP);
});

test("the heal is capped at full health", () => {
  const m = contestMatch({ a: 0, b: SPECIAL_TARGET_REPS });
  m.fighters.b = { ...m.fighters.b, hp: MAX_HP - 3 };
  const next = tickMatch(m);
  assert.equal(next.special?.healed, 3);
  assert.equal(next.fighters.b.hp, MAX_HP);
});

test("the time cap awards the contest to whoever is ahead", () => {
  const m = contestMatch({ a: 12, b: 31 }, { endTick: 1 });
  m.fighters.b = { ...m.fighters.b, hp: 4 };
  const next = tickMatch(m);
  assert.equal(next.phase, "live");
  assert.equal(next.special?.winner, "b");
  assert.equal(next.fighters.b.hp, 4 + SPECIAL_HEAL);
});

test("a tied contest heals nobody", () => {
  const m = contestMatch({ a: 9, b: 9 }, { endTick: 1 });
  m.fighters.a = { ...m.fighters.a, hp: 6 };
  m.fighters.b = { ...m.fighters.b, hp: 6 };
  const next = tickMatch(m);
  assert.equal(next.special?.winner, "draw");
  assert.equal(next.special?.healed, 0);
  assert.equal(next.fighters.a.hp, 6);
  assert.equal(next.fighters.b.hp, 6);
});

test("rep counts only ever move forward, and only during the contest", () => {
  let m = contestMatch({ a: 0, b: 0 });
  m = receiveReps(m, "a", repsMsg(1, 20));
  assert.equal(m.special?.reps.a, 20);

  m = receiveReps(m, "a", repsMsg(2, 3));
  assert.equal(m.special?.reps.a, 20, "a lower count cannot walk the number back");

  m = receiveReps(m, "a", repsMsg(2, 90));
  assert.equal(m.special?.reps.a, 20, "a replayed sequence number is ignored");

  const live = receiveReps(liveMatch(), "a", repsMsg(1, 50));
  assert.equal(live.special, null, "reps outside the contest are dropped");
});

test("the contest result rides along briefly, then clears", () => {
  let m = contestMatch({ a: SPECIAL_TARGET_REPS, b: 0 });
  m.fighters.a = { ...m.fighters.a, hp: 1 };
  m = tickMatch(m);
  assert.equal(specialPublic(m)?.winner, "a");
  assert.equal(specialPublic(m)?.ticksLeft, 0);

  for (let i = 0; i < 80; i++) m = tickMatch(m);
  assert.equal(m.special, null);
  assert.equal(specialPublic(m), undefined);
  assert.equal(m.phase, "live");
});

test("the contest re-arms every five casts rather than firing once", () => {
  let m = contestMatch({ a: SPECIAL_TARGET_REPS, b: 0 });
  m = tickMatch(m);
  assert.equal(m.phase, "live");

  m.attacks = SPECIAL_TRIGGER_ATTACKS;
  m = tickMatch(m);
  assert.equal(m.phase, "special", "a second contest opens after five more casts");
  assert.deepEqual(m.special?.reps, { a: 0, b: 0 });
  assert.equal(m.special?.winner, null);
});
