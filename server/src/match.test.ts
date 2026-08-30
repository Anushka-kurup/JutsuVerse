import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_HP,
  MAX_SHIELDS,
  MEME_GATE_BONUS_HP,
  MEME_GATE_MAX_TICKS,
  MEME_RACE_HEAL,
  MEME_RACE_MAX_TICKS,
  MEME_RACE_TRIGGER_ATTACKS,
  SHIELD_MAX_TICKS,
  SPECIAL_DAMAGE,
  SPECIAL_TARGET_REPS,
  type Seat,
} from "@jutsu/protocol";
import { ATTACKS, attackById, SHIELD } from "./commands.ts";
import { MEME_LABELS } from "./memeLabels.ts";

/** last seal of the shield sequence — the seal that must stay held (was 壬). */
const SHIELD_HOLD = SHIELD.seq[SHIELD.seq.length - 1];
import {
  createMatch,
  markReady,
  memeChallengePublic,
  receiveMeme,
  receiveReps,
  specialPublic,
  tickMatch,
  type MatchSession,
  type MemeChallenge,
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

/** Seed a finished seal sequence so the next tick casts it. Level 2 fires immediately. */
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
      damage: 0,
      resolvedAtTick: null,
      ...over,
    },
  };
}

function repsMsg(seq: number, reps: number) {
  return { type: "reps" as const, seq, reps, tClient: 0 };
}

function memeMsg(seq: number, label: string) {
  return { type: "meme" as const, seq, label };
}

function memeGateMatch(over: Partial<MemeChallenge> = {}): MatchSession {
  let m = createMatch();
  m = markReady(m, "a", "camera");
  m = markReady(m, "b", "camera");
  m = markReady(m, "a", "start");
  m = markReady(m, "b", "start");
  return {
    ...m,
    memeChallenge: { ...m.memeChallenge!, ...over },
  };
}

function memeRaceMatch(over: Partial<MemeChallenge> = {}): MatchSession {
  const m = liveMatch();
  return {
    ...m,
    phase: "memerace",
    memeChallenge: {
      label: "dab",
      startTick: 0,
      endTick: 10_000,
      doneAtTick: { a: null, b: null },
      winner: null,
      healed: 0,
      resolvedAtTick: null,
      ...over,
    },
  };
}

test("defines all elemental levels with the requested damage", () => {
  assert.equal(ATTACKS.length, 6);
  const bases = {
    fire: ["ox", "hare", "rat"],
    earth: ["dragon", "tiger", "dog"],
    water: ["ram", "monkey", "snake"],
  } as const;
  for (const element of ["fire", "earth", "water"] as const) {
    assert.equal(attackById(`${element}_1`)?.damage, 3);
    assert.equal(attackById(`${element}_2`)?.damage, 5);
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
  assert.equal(next.fighters.b.hp, MAX_HP - 3);
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
  assert.equal(next.fighters.b.hp, MAX_HP - 5);
});

test("same-element attacks both land their own damage", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_2"),
    b: pending("b", "fire_1"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP - 3);
  assert.equal(next.fighters.b.hp, MAX_HP - 5);
});

test("equal-level same-element attacks both land", () => {
  const m = liveMatch();
  m.pendingAttacks = {
    a: pending("a", "fire_2"),
    b: pending("b", "fire_2"),
  };
  const next = tickMatch(m);
  assert.equal(next.fighters.a.hp, MAX_HP - 5);
  assert.equal(next.fighters.b.hp, MAX_HP - 5);
});

test("one-second clash window is inclusive and rejects later attacks", () => {
  const inside = { ...liveMatch(), tick: 19 };
  inside.pendingAttacks = {
    a: pending("a", "fire_1", 0, 20),
    b: pending("b", "water_1", 20, 40),
  };
  const clashed = tickMatch(inside);
  assert.equal(clashed.fighters.a.hp, MAX_HP - 3);
  assert.equal(clashed.fighters.b.hp, MAX_HP);

  const outside = { ...liveMatch(), tick: 19 };
  outside.pendingAttacks = {
    a: pending("a", "fire_1", 0, 20),
    b: pending("b", "water_1", 21, 41),
  };
  const unopposed = tickMatch(outside);
  assert.equal(unopposed.fighters.b.hp, MAX_HP - 3);
  assert.notEqual(unopposed.pendingAttacks.b, null);
});

test("unopposed attack deals base damage and clears defender preparation", () => {
  const m = { ...liveMatch(), tick: 19 };
  m.fighters.b.buffer = [{ sign: "rat", tick: 10 }];
  m.pendingAttacks.a = pending("a", "fire_1");
  const next = tickMatch(m);
  assert.equal(next.fighters.b.hp, MAX_HP - 3);
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

test("seal buffer dedups, drops dead seals, and caps at the longest sequence", () => {
  let fighter = createMatch().fighters.a;
  const push = (sign: Parameters<typeof applyEdge>[1], tick: number) => {
    fighter = applyEdge(fighter, sign, "down", tick);
  };
  const buf = () => fighter.buffer.map((event) => event.sign);

  push("ox", 1);
  push("ox", 2); // consecutive duplicate — ignored
  assert.deepEqual(buf(), ["ox"]);

  push("hare", 3);
  push("rat", 4);
  push("boar", 5); // ox·hare·rat·boar = fire_2, the longest sequence
  assert.deepEqual(buf(), ["ox", "hare", "rat", "boar"]);

  push("dragon", 6); // ...·dragon starts no jutsu → the whole buffer dies,
  assert.deepEqual(buf(), ["dragon"]); //   and dragon (an EARTH starter) begins fresh

  push("dog", 7); // dragon·dog is not how EARTH starts (dragon·tiger·dog) → dropped
  assert.deepEqual(buf(), []);
});

test("both players ready opens the memegate with a random label from labels.csv", () => {
  let m = createMatch();
  m = markReady(m, "a", "camera");
  m = markReady(m, "b", "camera");
  m = markReady(m, "a", "start");
  m = markReady(m, "b", "start");
  assert.equal(m.phase, "memegate");
  assert.ok(MEME_LABELS.includes(m.memeChallenge!.label));
  assert.match(memeChallengePublic(m)!.image, /^memes\/img\/.+\.\w+$/, "the label's meme image rides along");
});

test("performing the memegate's label starts the match immediately, with bonus HP", () => {
  const m = memeGateMatch();
  const label = m.memeChallenge!.label;
  const next = receiveMeme(m, "a", memeMsg(1, label));
  assert.equal(next.phase, "live");
  assert.equal(next.memeChallenge, null);
  assert.equal(next.fighters.a.hp, MAX_HP + MEME_GATE_BONUS_HP, "the performer starts at 35");
  assert.equal(next.fighters.b.hp, MAX_HP, "the other player starts at the usual 30");
});

test("memegate requires the exact gesture that's shown", () => {
  const m = memeGateMatch({ label: "dab" });
  const other = MEME_LABELS.find((l) => l !== "dab")!;
  const wrong = receiveMeme(m, "a", memeMsg(1, other));
  assert.equal(wrong.phase, "memegate", "a different gesture does not resolve the gate");

  const right = receiveMeme(m, "a", memeMsg(1, "dab"));
  assert.equal(right.phase, "live");
  assert.equal(right.fighters.a.hp, MAX_HP + MEME_GATE_BONUS_HP);
});

test("the meme pool is limited to labels that have a meme image", () => {
  // mog / scheming_hand / scuba_ok are trained but have no image in memes/img/
  assert.ok(!MEME_LABELS.includes("mog"), "mog has no image, so it's out of the pool");
  assert.ok(MEME_LABELS.includes("dab"), "dab has an image");
  assert.ok(MEME_LABELS.length > 0);
});

test("memegate ignores a label that isn't the one shown", () => {
  const m = memeGateMatch({ label: "dab" });
  const next = receiveMeme(m, "a", memeMsg(1, "not_a_real_gesture"));
  assert.equal(next.phase, "memegate");
  assert.equal(next.memeChallenge?.doneAtTick.a, null);
});

test("memegate's countdown starts the match with no bonus when nobody performs it", () => {
  let next = memeGateMatch({ label: "dab" });
  for (let i = 0; i < MEME_GATE_MAX_TICKS + 1; i++) next = tickMatch(next);
  assert.equal(next.phase, "live");
  assert.equal(next.memeChallenge, null);
  assert.equal(next.fighters.a.hp, MAX_HP);
  assert.equal(next.fighters.b.hp, MAX_HP);
});

test("a gesture performed after the countdown has expired earns nothing", () => {
  let m = memeGateMatch({ label: "dab" });
  for (let i = 0; i < MEME_GATE_MAX_TICKS + 1; i++) m = tickMatch(m);
  const next = receiveMeme(m, "a", memeMsg(1, "dab"));
  assert.equal(next.fighters.a.hp, MAX_HP, "already live — the report is a no-op");
});

test("rematch resets only after both players are ready", () => {
  let m: MatchSession = { ...createMatch(), phase: "ended", winner: "a" };
  m.fighters.a.hp = 7;
  m.fighters.a.shields = 0;
  m = markReady(m, "a", "rematch");
  assert.equal(m.phase, "ended");
  m = markReady(m, "b", "rematch");
  assert.equal(m.phase, "memegate");
  assert.equal(m.fighters.a.hp, MAX_HP);
  assert.equal(m.fighters.a.shields, MAX_SHIELDS);
});

// ── 6-7 last-stand contest (opens on the first killing blow) ─────────

test("a killing blow opens the last-stand contest instead of ending the match", () => {
  let m = liveMatch();
  m.fighters.b = { ...m.fighters.b, hp: 3 };
  seedCast(m, "a", "fire_2"); // 5 damage — lethal

  m = tickMatch(m);
  assert.equal(m.phase, "live", "the triggering attack is still in flight");
  assert.notEqual(m.pendingAttacks.a, null);

  for (let i = 0; i < 40 && m.phase === "live"; i++) m = tickMatch(m);
  assert.equal(m.phase, "special");
  assert.equal(m.specialTriggered, true);
  assert.ok(m.fighters.b.hp <= 0, "b is still down — only winning the race saves them");
  assert.deepEqual(m.special?.reps, { a: 0, b: 0 });
});

test("a second killing blow ends the match — the last stand fires only once", () => {
  let m = liveMatch();
  m.specialTriggered = true; // already used this match
  m.fighters.b = { ...m.fighters.b, hp: 2 };
  seedCast(m, "a", "fire_2");

  for (let i = 0; i < 40 && m.phase === "live"; i++) m = tickMatch(m);
  assert.equal(m.phase, "ended");
  assert.equal(m.winner, "a");
});

test("opening the contest drops seals in progress but keeps HP and shields", () => {
  let m = liveMatch();
  m.fighters.b = { ...m.fighters.b, hp: 0 }; // already down → next tick opens the last stand
  m.fighters.a = {
    ...m.fighters.a,
    hp: 12,
    shields: 1,
    buffer: [{ sign: "rat", tick: 0 }],
    currentHold: "rat",
  };
  m = tickMatch(m);
  assert.equal(m.phase, "special");
  assert.equal(m.fighters.a.hp, 12);
  assert.equal(m.fighters.a.shields, 1);
  assert.deepEqual(m.fighters.a.buffer, []);
  assert.equal(m.fighters.a.currentHold, null);
});

test("winning the last stand still loses if you were the one who got downed", () => {
  let m = liveMatch();
  m.fighters.a = { ...m.fighters.a, hp: 2 };
  m.fighters.b = { ...m.fighters.b, hp: 25 };
  seedCast(m, "b", "fire_2"); // downs a → last stand

  for (let i = 0; i < 40 && m.phase === "live"; i++) m = tickMatch(m);
  assert.equal(m.phase, "special");
  assert.ok(m.fighters.a.hp <= 0);

  m.special = { ...m.special!, reps: { a: SPECIAL_TARGET_REPS, b: 3 } }; // a wins the race
  for (let i = 0; i < 80 && m.phase !== "ended"; i++) m = tickMatch(m);
  assert.equal(m.fighters.b.hp, 25 - SPECIAL_DAMAGE, "a's win still lands 10 on b");
  assert.equal(m.phase, "ended");
  assert.equal(m.winner, "b", "but a was already down, so a still loses");
});

test("winning the last stand takes the match if the 10 damage downs the opponent too", () => {
  let m = liveMatch();
  m.fighters.a = { ...m.fighters.a, hp: 2 };
  m.fighters.b = { ...m.fighters.b, hp: 8 }; // <= SPECIAL_DAMAGE
  seedCast(m, "b", "fire_2"); // downs a → last stand

  for (let i = 0; i < 40 && m.phase === "live"; i++) m = tickMatch(m);
  assert.equal(m.phase, "special");

  m.special = { ...m.special!, reps: { a: SPECIAL_TARGET_REPS, b: 3 } }; // a wins the race
  m = tickMatch(m);
  assert.equal(m.phase, "ended");
  assert.equal(m.winner, "a", "a's 10 damage downed b, and the contest winner takes it");
});

test("losing the last-stand contest ends the match", () => {
  let m = liveMatch();
  m.fighters.a = { ...m.fighters.a, hp: 2 };
  seedCast(m, "b", "fire_2");

  for (let i = 0; i < 40 && m.phase === "live"; i++) m = tickMatch(m);
  assert.equal(m.phase, "special");

  m.special = { ...m.special!, reps: { a: 3, b: SPECIAL_TARGET_REPS } }; // b wins the race
  for (let i = 0; i < 80 && m.phase !== "ended"; i++) m = tickMatch(m);
  assert.equal(m.phase, "ended");
  assert.equal(m.winner, "b", "a stayed down");
});

test("first to the target damages the loser and combat resumes", () => {
  const m = contestMatch({ a: SPECIAL_TARGET_REPS, b: 40 });
  const next = tickMatch(m);
  assert.equal(next.phase, "live");
  assert.equal(next.special?.winner, "a");
  assert.equal(next.special?.damage, SPECIAL_DAMAGE);
  assert.equal(next.fighters.b.hp, MAX_HP - SPECIAL_DAMAGE);
  assert.equal(next.fighters.a.hp, MAX_HP, "the winner's own HP is untouched");
});

test("winning at full health still costs the loser", () => {
  const m = contestMatch({ a: SPECIAL_TARGET_REPS, b: 0 });
  const next = tickMatch(m);
  assert.equal(next.special?.winner, "a");
  assert.equal(next.special?.damage, SPECIAL_DAMAGE);
  assert.equal(next.fighters.a.hp, MAX_HP);
  assert.equal(next.fighters.b.hp, MAX_HP - SPECIAL_DAMAGE);
});

test("losing the contest on low HP ends the match", () => {
  const m = contestMatch({ a: SPECIAL_TARGET_REPS, b: 3 });
  m.fighters.b = { ...m.fighters.b, hp: 4 };
  const next = tickMatch(m);
  assert.equal(next.fighters.b.hp, 0);
  assert.equal(next.special?.damage, 4, "reports what actually landed, not the full hit");
  assert.equal(next.phase, "ended");
  assert.equal(next.winner, "a");
});

test("the time cap awards the contest to whoever is ahead", () => {
  const m = contestMatch({ a: 12, b: 31 }, { endTick: 1 });
  const next = tickMatch(m);
  assert.equal(next.phase, "live");
  assert.equal(next.special?.winner, "b");
  assert.equal(next.fighters.a.hp, MAX_HP - SPECIAL_DAMAGE);
  assert.equal(next.fighters.b.hp, MAX_HP);
});

test("a tied contest damages nobody", () => {
  const m = contestMatch({ a: 9, b: 9 }, { endTick: 1 });
  m.fighters.a = { ...m.fighters.a, hp: 6 };
  m.fighters.b = { ...m.fighters.b, hp: 6 };
  const next = tickMatch(m);
  assert.equal(next.special?.winner, "draw");
  assert.equal(next.special?.damage, 0);
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
  m = tickMatch(m);
  assert.equal(specialPublic(m)?.winner, "a");
  assert.equal(specialPublic(m)?.ticksLeft, 0);

  for (let i = 0; i < 80; i++) m = tickMatch(m);
  assert.equal(m.special, null);
  assert.equal(specialPublic(m), undefined);
  assert.equal(m.phase, "live");
});

test("the last-stand contest never re-opens once it has fired", () => {
  let m = contestMatch({ a: SPECIAL_TARGET_REPS, b: 0 });
  m.specialTriggered = true; // it opened earlier this match
  m.fighters.a = { ...m.fighters.a, hp: 20 };
  m = tickMatch(m); // resolves the contest → live
  assert.equal(m.phase, "live");

  m.fighters.b = { ...m.fighters.b, hp: 0 }; // another killing blow
  m = tickMatch(m);
  assert.equal(m.phase, "ended", "no second contest — the match just ends");
  assert.equal(m.winner, "a");
});

// ── recurring meme race (every MEME_RACE_TRIGGER_ATTACKS casts) ───────

test("a meme race opens every MEME_RACE_TRIGGER_ATTACKS casts, once the attack has landed", () => {
  let m = liveMatch();
  m.castsSinceMemeRace = MEME_RACE_TRIGGER_ATTACKS - 1;
  seedCast(m, "a", "fire_2");

  m = tickMatch(m);
  assert.equal(m.castsSinceMemeRace, MEME_RACE_TRIGGER_ATTACKS);
  assert.equal(m.phase, "live", "the triggering attack is still in flight");

  for (let i = 0; i < 40 && m.phase === "live"; i++) m = tickMatch(m);
  assert.equal(m.phase, "memerace");
  assert.ok(MEME_LABELS.includes(m.memeChallenge!.label));
  assert.equal(m.castsSinceMemeRace, 0, "the counter re-arms for the next race");
});

test("the meme race re-arms — another opens MEME_RACE_TRIGGER_ATTACKS casts later", () => {
  let m = memeRaceMatch({ label: "dab" });
  m = receiveMeme(m, "a", memeMsg(1, "dab"));
  assert.equal(m.phase, "live");

  m.castsSinceMemeRace = MEME_RACE_TRIGGER_ATTACKS;
  m = tickMatch(m);
  assert.equal(m.phase, "memerace", "a second race opens after another trigger-count casts");
  assert.equal(m.memeChallenge?.winner, null);
});

test("performing the meme race's label heals the first to do it by MEME_RACE_HEAL", () => {
  const m = memeRaceMatch({ label: "dab" });
  m.fighters.a = { ...m.fighters.a, hp: 25 };
  const next = receiveMeme(m, "a", memeMsg(1, "dab"));
  assert.equal(next.phase, "live");
  assert.equal(next.memeChallenge?.winner, "a");
  assert.equal(next.memeChallenge?.healed, MEME_RACE_HEAL);
  assert.equal(next.fighters.a.hp, 25 + MEME_RACE_HEAL);
});

test("the meme-race heal never lowers a fighter already above MAX_HP", () => {
  const m = memeRaceMatch({ label: "dab" });
  m.fighters.a = { ...m.fighters.a, hp: MAX_HP + 3 }; // 33, from the memegate bonus
  const next = receiveMeme(m, "a", memeMsg(1, "dab"));
  assert.equal(next.fighters.a.hp, MAX_HP + 3, "stays at 33 — a no-op, not a cut to 30");
  assert.equal(next.memeChallenge?.healed, 0);
});

test("the meme-race heal is capped at full health", () => {
  const m = memeRaceMatch({ label: "dab" });
  const next = receiveMeme(m, "a", memeMsg(1, "dab"));
  assert.equal(next.fighters.a.hp, MAX_HP);
  assert.equal(next.memeChallenge?.healed, 0);
});

test("the meme race requires the exact gesture shown, and the banner keeps that label", () => {
  const m = memeRaceMatch({ label: "dab" });
  m.fighters.a = { ...m.fighters.a, hp: 10 };

  const wrong = receiveMeme(m, "a", memeMsg(1, "korean_heart"));
  assert.equal(wrong.memeChallenge?.winner, null, "a different gesture does not win");
  assert.equal(wrong.fighters.a.hp, 10);

  const right = receiveMeme(m, "a", memeMsg(1, "dab"));
  assert.equal(right.memeChallenge?.winner, "a");
  assert.equal(right.fighters.a.hp, 10 + MEME_RACE_HEAL);
  assert.equal(right.memeChallenge?.label, "dab", "the banner still shows the gesture that was set");
});

test("the meme race ignores a label that isn't the one shown", () => {
  const m = memeRaceMatch({ label: "dab" });
  const next = receiveMeme(m, "a", memeMsg(1, "not_a_real_gesture"));
  assert.equal(next.memeChallenge?.winner, null);
  assert.equal(next.fighters.a.hp, MAX_HP);
});

test("the second player to perform the meme race's label gets nothing", () => {
  let m = memeRaceMatch({ label: "dab" });
  m = receiveMeme(m, "a", memeMsg(1, "dab"));
  const next = receiveMeme(m, "b", memeMsg(1, "dab"));
  assert.equal(next.memeChallenge?.winner, "a", "already resolved — b's report is a no-op");
  assert.equal(next.fighters.b.hp, MAX_HP);
});

test("the meme race's time cap resolves as a draw — nobody heals", () => {
  const m = memeRaceMatch({ endTick: 1 });
  const next = tickMatch(m);
  assert.equal(next.phase, "live");
  assert.equal(next.memeChallenge?.winner, "draw");
  assert.equal(next.memeChallenge?.healed, 0);
});

test("the meme race result rides along briefly, then clears", () => {
  let m = memeRaceMatch({ label: "dab" });
  m = receiveMeme(m, "a", memeMsg(1, "dab"));
  assert.equal(memeChallengePublic(m)?.winner, "a");

  for (let i = 0; i < 80; i++) m = tickMatch(m);
  assert.equal(m.memeChallenge, null);
  assert.equal(memeChallengePublic(m), undefined);
});
