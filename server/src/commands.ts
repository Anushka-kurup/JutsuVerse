import type { Sign } from "@jutsu/protocol";
import { SKILLS, type SkillElement, type SkillLevel } from "../../shared/skills.ts";

export interface AttackCommand {
  id: string;
  seq: Sign[];
  element: SkillElement;
  level: SkillLevel;
  damage: number;
}

export interface ShieldCommand {
  id: "shield";
  seq: Sign[];
}

export const ATTACKS: AttackCommand[] = SKILLS.filter(
  (skill) => skill.action === "ATTACK",
).map((skill) => ({
  id: skill.id,
  seq: skill.seals as Sign[],
  element: skill.element!,
  level: skill.level!,
  damage: skill.damage,
}));

const shield = SKILLS.find((skill) => skill.action === "SHIELD")!;
export const SHIELD: ShieldCommand = {
  id: "shield",
  seq: shield.seals as Sign[],
};

export interface BufferEvent {
  sign: Sign;
  tick: number;
}

export function attackById(id: string): AttackCommand | undefined {
  return ATTACKS.find((command) => command.id === id);
}

/** Every castable sequence (attacks + shield). */
const ALL_SEQS: Sign[][] = [...ATTACKS.map((c) => c.seq), SHIELD.seq];

/** True when `signs` is the start of (or exactly) at least one skill sequence. */
export function isLivePrefix(signs: Sign[]): boolean {
  if (signs.length === 0) return true;
  return ALL_SEQS.some(
    (seq) => seq.length >= signs.length && signs.every((s, i) => seq[i] === s),
  );
}

/**
 * Skill sequences no longer overlap, so a seal that can't extend any sequence is
 * dead weight. Drop buffered seals from the front until the whole buffer is a
 * live prefix again; if even the newest seal starts no skill, the buffer empties.
 */
export function pruneBuffer(buffer: BufferEvent[]): BufferEvent[] {
  let out = buffer;
  while (out.length > 0 && !isLivePrefix(out.map((e) => e.sign))) {
    out = out.slice(1);
  }
  return out;
}

/** Return the longest completed attack at the end of the current buffer. */
export function matchAttack(buffer: BufferEvent[]): AttackCommand | null {
  const ranked = [...ATTACKS].sort((a, b) => b.seq.length - a.seq.length);
  return ranked.find((command) => endsWith(buffer, command.seq)) ?? null;
}

export function matchesShield(buffer: BufferEvent[]): boolean {
  return endsWith(buffer, SHIELD.seq);
}

export function consumeSuffix(buffer: BufferEvent[], length: number): BufferEvent[] {
  return buffer.slice(0, Math.max(0, buffer.length - length));
}

function endsWith(buffer: BufferEvent[], sequence: Sign[]): boolean {
  if (buffer.length < sequence.length) return false;
  const suffix = buffer.slice(-sequence.length);
  return suffix.every((event, index) => event.sign === sequence[index]);
}
