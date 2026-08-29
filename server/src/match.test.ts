import assert from "node:assert/strict";
import test from "node:test";
import { COUNTDOWN_TICKS, MAX_HP, MAX_SHIELDS } from "@jutsu/protocol";
import { ATTACKS, attackById } from "./commands.ts";
import {
  countdownValue,
  createMatch,
  markReady,
  tickMatch,
  type MatchSession,
  type PendingAttack,
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
  assert.equal(next.fighters.b.hp, MAX_HP - 1);
  assert.deepEqual(next.pendingAttacks, { a: null, b: null });
});

test("higher-level counter deals its own damage and takes none", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_3"),
    b: pending("b", "wind_1"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP);
  assert.equal(next.fighters.b.hp, MAX_HP - 4);
});

test("opposite elements both land their own damage", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_1"),
    b: pending("b", "earth_3"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP - 4);
  assert.equal(next.fighters.b.hp, MAX_HP - 1);
});

test("equal-level non-countering attacks both land", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_2"),
    b: pending("b", "earth_2"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP - 2);
  assert.equal(next.fighters.b.hp, MAX_HP - 2);
});

test("one-second clash window is inclusive and rejects later attacks", () => {
  const inside = { ...liveMatch(), tick: 19 };
  inside.pendingAttacks = {
    a: pending("a", "fire_1", 0, 20),
    b: pending("b", "wind_1", 20, 40),
  };
  const clashed = tickMatch(inside);
  assert.equal(clashed.fighters.a.hp, MAX_HP);
  assert.equal(clashed.fighters.b.hp, MAX_HP - 1);

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
