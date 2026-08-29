import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sign } from "@jutsu/protocol";
import { consumeSuffix, matchBuffer, type BufferEvent } from "./commands.ts";

function buf(seq: Sign[], startTick = 10): BufferEvent[] {
  return seq.map((sign, i) => ({
    sign,
    tick: startTick + i * 2,
  }));
}

test("TIGER SNAKE RAM suffix matches tiger", () => {
  const cmd = matchBuffer(buf(["TIGER", "SNAKE", "RAM"]), 14);
  assert.equal(cmd?.id, "tiger");
});

test("leading BOAR still matches tiger", () => {
  const cmd = matchBuffer(buf(["BOAR", "TIGER", "SNAKE", "RAM"]), 16);
  assert.equal(cmd?.id, "tiger");
});

test("garbage in the middle does not match tiger", () => {
  const cmd = matchBuffer(buf(["TIGER", "BOAR", "SNAKE", "RAM"]), 16);
  assert.equal(cmd, null);
});

test("TIGER SNAKE RAM outside the 900ms window does not match", () => {
  const old: BufferEvent[] = [
    { sign: "TIGER", tick: 0 },
    { sign: "SNAKE", tick: 2 },
    { sign: "RAM", tick: 4 },
  ];
  const cmd = matchBuffer(old, 40);
  assert.equal(cmd, null);
});

test("consumeSuffix drops the matched presses", () => {
  const next = consumeSuffix(buf(["BOAR", "TIGER", "SNAKE", "RAM"]), 3);
  assert.deepEqual(
    next.map((e) => e.sign),
    ["BOAR"],
  );
});

test("BOAR SNAKE suffix matches guard", () => {
  const cmd = matchBuffer(buf(["BOAR", "SNAKE"]), 12);
  assert.equal(cmd?.id, "guard");
});

test("SNAKE RAM TIGER suffix matches serpent", () => {
  const cmd = matchBuffer(buf(["SNAKE", "RAM", "TIGER"]), 14);
  assert.equal(cmd?.id, "serpent");
});

test("RAM TIGER BOAR suffix matches ox", () => {
  const cmd = matchBuffer(buf(["RAM", "TIGER", "BOAR"]), 14);
  assert.equal(cmd?.id, "ox");
});

test("TIGER BOAR RAM suffix matches boar", () => {
  const cmd = matchBuffer(buf(["TIGER", "BOAR", "RAM"]), 14);
  assert.equal(cmd?.id, "boar");
});

test("BIRD OX TIGER suffix matches crane", () => {
  const cmd = matchBuffer(buf(["BIRD", "OX", "TIGER"]), 14);
  assert.equal(cmd?.id, "crane");
});

test("OX BOAR BIRD suffix matches hare", () => {
  const cmd = matchBuffer(buf(["OX", "BOAR", "BIRD"]), 14);
  assert.equal(cmd?.id, "hare");
});

test("BIRD TIGER OX suffix matches dragon", () => {
  const cmd = matchBuffer(buf(["BIRD", "TIGER", "OX"]), 14);
  assert.equal(cmd?.id, "dragon");
});
