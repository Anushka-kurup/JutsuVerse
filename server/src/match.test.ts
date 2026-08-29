import assert from "node:assert/strict";
import test from "node:test";
import { COUNTDOWN_TICKS, MAX_HP, MAX_SHIELDS, SHIELD_MAX_TICKS } from "@jutsu/protocol";
import { ATTACKS, attackById, SHIELD } from "./commands.ts";

/** last seal of the shield sequence — the seal that must stay held (was 壬). */
const SHIELD_HOLD = SHIELD.seq[SHIELD.seq.length - 1];
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
  assert.equal(ATTACKS.length, 6);
  const bases = {
    fire: ["rat", "ox", "tiger"],
    earth: ["horse", "ram", "monkey"],
    water: ["bird", "dog", "boar"],
  } as const;
  for (const element of ["fire", "earth", "water"] as const) {
    assert.equal(attackById(`${element}_1`)?.damage, 1);
    assert.equal(attackById(`${element}_2`)?.damage, 2);
    assert.equal(attackById(`${element}_3`), undefined);
    assert.equal(attackById(`${element}_1`)?.seq.length, 3);
    assert.equal(attackById(`${element}_2`)?.seq.length, 4);
    assert.deepEqual(attackById(`${element}_1`)?.seq, bases[element]);
    const l2 = attackById(`${element}_2`)!.seq;
    assert.deepEqual(l2.slice(0, 3), bases[element]);
    assert.ok(
      !(bases[element] as readonly string[]).includes(l2[3]),
      "amp seal is not part of the base",
    );
  }
  assert.equal(attackById("wind_1"), undefined);
});

test("elemental counter wins a clash regardless of level", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "water_1"),
    b: pending("b", "fire_2"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP);
  assert.equal(next.fighters.b.hp, MAX_HP - 1);
  assert.deepEqual(next.pendingAttacks, { a: null, b: null });
});

test("higher-level counter deals its own damage and takes none", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_2"),
    b: pending("b", "earth_1"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP);
  assert.equal(next.fighters.b.hp, MAX_HP - 2);
});

test("same-element attacks both land their own damage", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_2"),
    b: pending("b", "fire_1"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP - 1);
  assert.equal(next.fighters.b.hp, MAX_HP - 2);
});

test("equal-level same-element attacks both land", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_2"),
    b: pending("b", "fire_2"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP - 2);
  assert.equal(next.fighters.b.hp, MAX_HP - 2);
});

test("one-second clash window is inclusive and rejects later attacks", () => {
  const inside = { ...liveMatch(), tick: 19 };
  inside.pendingAttacks = {
    a: pending("a", "fire_1", 0, 20),
    b: pending("b", "water_1", 20, 40),
  };
  const clashed = tickMatch(inside);
  assert.equal(clashed.fighters.a.hp, MAX_HP - 1);
  assert.equal(clashed.fighters.b.hp, MAX_HP);

  const outside = { ...liveMatch(), tick: 19 };
  outside.pendingAttacks = {
    a: pending("a", "fire_1", 0, 20),
    b: pending("b", "water_1", 21, 41),
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

function raiseShield(fighter: ReturnType<typeof createMatch>["fighters"]["a"], tick: number) {
  let next = applyHold(fighter, SHIELD_HOLD);
  next = applyEdge(next, "gassho", "down", tick);
  return stepFighter(next, tick).fighter;
}

test("raising a shield consumes one charge and blocking a hit does not spend another", () => {
  let defender = raiseShield(createMatch().fighters.b, 1);
  assert.equal(defender.stance, "block");
  assert.equal(defender.shields, MAX_SHIELDS - 1);

  const m = { ...liveMatch(), tick: 19 };
  m.fighters.b = { ...defender, currentHold: SHIELD_HOLD, shieldUntilTick: 60 };
  m.pendingAttacks.a = pending("a", "fire_2");
  const next = tickMatch(m);
  assert.equal(next.fighters.b.hp, MAX_HP);
  assert.equal(next.fighters.b.shields, MAX_SHIELDS - 1);
  assert.equal(next.fighters.b.stance, "idle");
});

test("shield sequence is gassho then hold-seal and requires the hold-seal to remain held", () => {
  const active = raiseShield(createMatch().fighters.a, 2);
  assert.equal(active.stance, "block");
  assert.equal(active.shields, MAX_SHIELDS - 1);

  const released = stepFighter(applyHold(active, null), 3).fighter;
  assert.equal(released.stance, "idle");
  assert.equal(released.shields, MAX_SHIELDS - 1);

  const expired = stepFighter({ ...active, shieldUntilTick: 3 }, 3).fighter;
  assert.equal(expired.stance, "idle");
  assert.equal(expired.shields, MAX_SHIELDS - 1);
  assert.equal(expired.shieldLock, true);
});

test("timed-out shield cannot recast until the hold is released", () => {
  let fighter = raiseShield(createMatch().fighters.a, 1);
  fighter = applyEdge(fighter, "gassho", "down", 2);
  fighter = stepFighter({ ...fighter, shieldUntilTick: 1 + SHIELD_MAX_TICKS }, 1 + SHIELD_MAX_TICKS).fighter;
  assert.equal(fighter.stance, "idle");
  assert.equal(fighter.shields, MAX_SHIELDS - 1);

  const locked = stepFighter(fighter, 1 + SHIELD_MAX_TICKS + 1).fighter;
  assert.equal(locked.stance, "idle");
  assert.equal(locked.shields, MAX_SHIELDS - 1);

  let released = stepFighter(applyHold(locked, null), 1 + SHIELD_MAX_TICKS + 2).fighter;
  assert.equal(released.shieldLock, false);
  released = raiseShield(released, 1 + SHIELD_MAX_TICKS + 3);
  assert.equal(released.stance, "block");
  assert.equal(released.shields, MAX_SHIELDS - 2);
});

test("a fighter can raise shield only three times", () => {
  let fighter = createMatch().fighters.a;
  for (let i = 0; i < MAX_SHIELDS; i++) {
    fighter = raiseShield(fighter, i * 2 + 1);
    assert.equal(fighter.stance, "block");
    assert.equal(fighter.shields, MAX_SHIELDS - 1 - i);
    fighter = stepFighter(applyHold(fighter, null), i * 2 + 2).fighter;
    assert.equal(fighter.stance, "idle");
  }
  fighter = raiseShield(fighter, 20);
  assert.equal(fighter.stance, "idle");
  assert.equal(fighter.shields, 0);
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
