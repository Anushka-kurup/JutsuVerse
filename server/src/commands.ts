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
