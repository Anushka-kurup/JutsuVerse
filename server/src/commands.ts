import { TICK_MS, type Sign } from "@jutsu/protocol";

export type MoveKind = "attack" | "guard";

export interface Command {
  id: string;
  seq: Sign[];
  move: MoveKind;
  windowMs: number;
  priority: number;
  startupTicks: number;
  activeTicks: number;
  recoverTicks: number;
  damage: number;
  guardTicks: number;
}

export const COMMANDS: Command[] = [
  {
    id: "tiger",
    seq: ["TIGER", "SNAKE", "RAM"],
    move: "attack",
    windowMs: 900,
    priority: 20,
    startupTicks: 7,
    activeTicks: 3,
    recoverTicks: 5,
    damage: 2,
    guardTicks: 0,
  },
  {
    id: "serpent",
    seq: ["SNAKE", "RAM", "TIGER"],
    move: "attack",
    windowMs: 900,
    priority: 20,
    startupTicks: 4,
    activeTicks: 3,
    recoverTicks: 4,
    damage: 2,
    guardTicks: 0,
  },
  {
    id: "ox",
    seq: ["RAM", "TIGER", "BOAR"],
    move: "attack",
    windowMs: 900,
    priority: 20,
    startupTicks: 6,
    activeTicks: 3,
    recoverTicks: 5,
    damage: 2,
    guardTicks: 0,
  },
  {
    id: "boar",
    seq: ["TIGER", "BOAR", "RAM"],
    move: "attack",
    windowMs: 1000,
    priority: 20,
    startupTicks: 10,
    activeTicks: 4,
    recoverTicks: 6,
    damage: 3,
    guardTicks: 0,
  },
  {
    id: "crane",
    seq: ["BIRD", "OX", "TIGER"],
    move: "attack",
    windowMs: 900,
    priority: 20,
    startupTicks: 5,
    activeTicks: 3,
    recoverTicks: 4,
    damage: 2,
    guardTicks: 0,
  },
  {
    id: "hare",
    seq: ["OX", "BOAR", "BIRD"],
    move: "attack",
    windowMs: 900,
    priority: 20,
    startupTicks: 5,
    activeTicks: 3,
    recoverTicks: 5,
    damage: 2,
    guardTicks: 0,
  },
  {
    id: "dragon",
    seq: ["BIRD", "TIGER", "OX"],
    move: "attack",
    windowMs: 1000,
    priority: 20,
    startupTicks: 8,
    activeTicks: 4,
    recoverTicks: 6,
    damage: 3,
    guardTicks: 0,
  },
  {
    id: "guard",
    seq: ["BOAR", "SNAKE"],
    move: "guard",
    windowMs: 500,
    priority: 10,
    startupTicks: 0,
    activeTicks: 0,
    recoverTicks: 0,
    damage: 0,
    guardTicks: 40,
  },
];

export function commandById(id: string): Command | undefined {
  return COMMANDS.find((c) => c.id === id);
}

export interface BufferEvent {
  sign: Sign;
  tick: number;
}

/**
 * Suffix match: the last N downs must be exactly cmd.seq, all inside the window.
 * [BOAR, TIGER, SNAKE, RAM] matches tiger. [TIGER, BOAR, SNAKE, RAM] does not
 * (garbage in the middle).
 */
export function matchBuffer(
  buffer: BufferEvent[],
  tick: number,
): Command | null {
  const ranked = [...COMMANDS].sort(
    (a, b) => b.priority - a.priority || b.seq.length - a.seq.length,
  );

  for (const cmd of ranked) {
    const windowTicks = Math.max(1, Math.ceil(cmd.windowMs / TICK_MS));
    const recent = buffer.filter((e) => tick - e.tick <= windowTicks);
    if (recent.length < cmd.seq.length) continue;
    const suffix = recent.slice(-cmd.seq.length);
    const matches = suffix.every((e, i) => e.sign === cmd.seq[i]);
    if (!matches) continue;
    if (tick - suffix[0].tick > windowTicks) continue;
    return cmd;
  }
  return null;
}

export function consumeSuffix(
  buffer: BufferEvent[],
  n: number,
): BufferEvent[] {
  if (n <= 0) return buffer;
  return buffer.slice(0, Math.max(0, buffer.length - n));
}
