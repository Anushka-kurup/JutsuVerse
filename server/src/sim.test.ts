import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INPUT_DELAY_TICKS,
  MAX_HP,
  type InputMsg,
  type Sign,
} from "@jutsu/protocol";
import {
  createMatch,
  markReady,
  receiveInput,
  tickMatch,
} from "./match.ts";
import {
  ACTIVE_TICKS,
  GUARD_TICKS,
  STARTUP_TICKS,
  applyEdge,
  createFighter,
  guardedDamage,
  resolveHits,
  stepFighter,
} from "./sim.ts";

function bothReady() {
  let m = createMatch();
  m = markReady(m, "a");
  m = markReady(m, "b");
  assert.equal(m.phase, "live");
  return m;
}

function press(
  m: ReturnType<typeof createMatch>,
  seat: "a" | "b",
  sign: Sign,
  seq: number,
) {
  const msg: InputMsg = {
    type: "input",
    seq,
    sign,
    edge: "down",
    tClient: 0,
  };
  return receiveInput(m, seat, msg);
}

function release(
  m: ReturnType<typeof createMatch>,
  seat: "a" | "b",
  sign: Sign,
  seq: number,
) {
  const msg: InputMsg = {
    type: "input",
    seq,
    sign,
    edge: "up",
    tClient: 0,
  };
  return receiveInput(m, seat, msg);
}

function advance(m: ReturnType<typeof createMatch>, n: number) {
  let next = m;
  for (let i = 0; i < n; i++) next = tickMatch(next);
  return next;
}

test("TIGER SNAKE RAM from idle enters startup then active", () => {
  let f = createFighter();
  f = applyEdge(f, "TIGER", "down", 10);
  f = applyEdge(f, "SNAKE", "down", 12);
  f = applyEdge(f, "RAM", "down", 14);
  f = stepFighter(f, 14);
  assert.equal(f.stance, "startup");
  assert.equal(f.moveId, "tiger");

  f = stepFighter(f, 14 + STARTUP_TICKS);
  assert.equal(f.stance, "active");
  assert.equal(f.activeFromTick, 14 + STARTUP_TICKS);
});

test("SNAKE RAM TIGER from idle is serpent with shorter startup", () => {
  let f = createFighter();
  f = applyEdge(f, "SNAKE", "down", 10);
  f = applyEdge(f, "RAM", "down", 12);
  f = applyEdge(f, "TIGER", "down", 14);
  f = stepFighter(f, 14);
  assert.equal(f.moveId, "serpent");
  assert.equal(f.stance, "startup");
  f = stepFighter(f, 17);
  assert.equal(f.stance, "startup");
  f = stepFighter(f, 18);
  assert.equal(f.stance, "active");
});

test("holding BOAR does not guard", () => {
  let f = createFighter();
  f = applyEdge(f, "BOAR", "down", 10);
  f = stepFighter(f, 10);
  assert.equal(f.stance, "idle");
});

test("BOAR SNAKE enters timed guard", () => {
  let f = createFighter();
  f = applyEdge(f, "BOAR", "down", 10);
  f = applyEdge(f, "SNAKE", "down", 12);
  f = stepFighter(f, 12);
  assert.equal(f.stance, "block");
  assert.equal(f.moveId, "guard");
  assert.equal(f.stanceUntilTick, 12 + GUARD_TICKS);
  f = stepFighter(f, 12 + GUARD_TICKS);
  assert.equal(f.stance, "idle");
});

test("BOAR SNAKE during startup cancels into guard", () => {
  let f = createFighter();
  f = applyEdge(f, "TIGER", "down", 10);
  f = applyEdge(f, "SNAKE", "down", 12);
  f = applyEdge(f, "RAM", "down", 14);
  f = stepFighter(f, 14);
  assert.equal(f.stance, "startup");
  f = applyEdge(f, "TIGER", "up", 15);
  f = applyEdge(f, "SNAKE", "up", 15);
  f = applyEdge(f, "RAM", "up", 15);
  f = applyEdge(f, "BOAR", "down", 16);
  f = applyEdge(f, "SNAKE", "down", 17);
  f = stepFighter(f, 17);
  assert.equal(f.stance, "block");
  assert.equal(f.moveId, "guard");
});

test("active vs idle deals attack damage on first active tick only", () => {
  let a = createFighter();
  let b = createFighter();
  a = {
    ...a,
    stance: "active",
    activeFromTick: 20,
    stanceUntilTick: 20 + ACTIVE_TICKS,
    attackDamage: 2,
  };
  let r = resolveHits(a, b, 20);
  assert.equal(r.b.hp, MAX_HP - 2);
  assert.equal(r.b.stance, "hitstun");
  r = resolveHits(r.a, r.b, 21);
  assert.equal(r.b.hp, MAX_HP - 2);
});

test("guard reduces damage and stays in block", () => {
  let a = createFighter();
  let b = createFighter();
  a = {
    ...a,
    stance: "active",
    activeFromTick: 20,
    stanceUntilTick: 20 + ACTIVE_TICKS,
    attackDamage: 2,
  };
  b = { ...b, stance: "block", moveId: "guard", stanceUntilTick: 60 };
  const r = resolveHits(a, b, 20);
  assert.equal(r.b.hp, MAX_HP - guardedDamage(2));
  assert.equal(r.b.stance, "block");
});

test("both first-active same tick is a trade", () => {
  let a = createFighter();
  let b = createFighter();
  a = {
    ...a,
    stance: "active",
    activeFromTick: 20,
    stanceUntilTick: 20 + ACTIVE_TICKS,
    attackDamage: 2,
  };
  b = {
    ...b,
    stance: "active",
    activeFromTick: 20,
    stanceUntilTick: 20 + ACTIVE_TICKS,
    attackDamage: 2,
  };
  const r = resolveHits(a, b, 20);
  assert.equal(r.a.hp, MAX_HP - 2);
  assert.equal(r.b.hp, MAX_HP - 2);
  assert.equal(r.a.stance, "hitstun");
  assert.equal(r.b.stance, "hitstun");
});

test("match delay: TIGER SNAKE RAM becomes startup after delay ticks", () => {
  let m = bothReady();
  m = press(m, "a", "TIGER", 1);
  m = press(m, "a", "SNAKE", 2);
  m = press(m, "a", "RAM", 3);
  m = advance(m, INPUT_DELAY_TICKS);
  assert.equal(m.fighters.a.stance, "startup");
});

test("B can guard during A's startup through the delay buffer", () => {
  let m = bothReady();
  m = press(m, "a", "TIGER", 1);
  m = press(m, "a", "SNAKE", 2);
  m = press(m, "a", "RAM", 3);
  m = advance(m, INPUT_DELAY_TICKS);
  assert.equal(m.fighters.a.stance, "startup");
  m = press(m, "b", "BOAR", 1);
  m = press(m, "b", "SNAKE", 2);
  m = advance(m, INPUT_DELAY_TICKS);
  assert.equal(m.fighters.b.stance, "block");
  m = advance(m, STARTUP_TICKS + 2);
  assert.equal(m.fighters.b.hp, MAX_HP - guardedDamage(2));
  assert.equal(m.fighters.b.stance, "block");
});

test("three unblocked tigers end the match", () => {
  let m = bothReady();
  let seq = 1;
  for (let hit = 0; hit < 3; hit++) {
    m = press(m, "a", "TIGER", seq++);
    m = press(m, "a", "SNAKE", seq++);
    m = press(m, "a", "RAM", seq++);
    m = advance(m, INPUT_DELAY_TICKS + STARTUP_TICKS + 1);
    m = release(m, "a", "TIGER", seq++);
    m = release(m, "a", "SNAKE", seq++);
    m = release(m, "a", "RAM", seq++);
    m = advance(m, 12);
  }
  assert.equal(m.fighters.b.hp, 0);
  assert.equal(m.phase, "ended");
  assert.equal(m.winner, "a");
});
