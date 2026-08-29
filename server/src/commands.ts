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
  /** chakra spent when the move starts */
  energyCost: number;
}

/**
 * The five jutsu. Sequences are the frontend's seal combos (shared/skills.ts);
 * cost / damage scale with seal count (× 10 energy, × 5 hp). `windowMs` is wide
 * because a camera-detected seal takes ~3 s to confirm — a 5-seal jutsu needs
 * the whole run to fit inside ~30 s.
 */
const attack = (id: string, seq: Sign[]): Command => ({
  id,
  seq,
  move: "attack",
  windowMs: seq.length * 6000,
  priority: 20,
  startupTicks: 6,
  activeTicks: 3,
  recoverTicks: 5,
  damage: seq.length * 5,
  guardTicks: 0,
  energyCost: seq.length * 10,
});

const guard = (id: string, seq: Sign[], guardTicks: number): Command => ({
  id,
  seq,
  move: "guard",
  windowMs: seq.length * 6000,
  priority: 10,
  startupTicks: 0,
  activeTicks: 0,
  recoverTicks: 0,
  damage: 0,
  guardTicks,
  energyCost: seq.length * 10,
});

export const COMMANDS: Command[] = [
  attack("fireball", ["snake", "ram", "monkey", "horse", "tiger"]),
  attack("water_trumpet", ["dragon", "tiger", "hare"]),
  attack("great_breakthrough", ["tiger", "dog", "horse"]),
  guard("clone", ["ram", "snake", "tiger"], 30), // Reflect-ish: short block
  guard("substitution", ["ram", "boar", "ox", "dog", "snake"], 50), // Protect: long block
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
 * [boar, tiger, snake, ram] matches a [tiger,snake,ram] command.
 * [tiger, boar, snake, ram] does not (garbage in the middle).
 */
export function matchBuffer(buffer: BufferEvent[], tick: number): Command | null {
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

export function consumeSuffix(buffer: BufferEvent[], n: number): BufferEvent[] {
  if (n <= 0) return buffer;
  return buffer.slice(0, Math.max(0, buffer.length - n));
}
