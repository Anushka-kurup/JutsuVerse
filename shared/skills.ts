export type SkillAction = "ATTACK" | "SHIELD";
export type SkillElement = "FIRE" | "WATER" | "EARTH";
export type SkillLevel = 1 | 2;

export interface SkillDef {
  id: string;
  name: string;
  nameJa: string;
  seals: string[];
  action: SkillAction;
  element: SkillElement | null;
  level: SkillLevel | null;
  damage: number;
  /** Path below frontend/public (attack skills only). */
  image: string | null;
}

const DAMAGE: Record<SkillLevel, number> = { 1: 1, 2: 2 };

/**
 * 3-seal base per element. Level 2 appends one "amp" seal.
 * (壬 Mizunoe used to be the shared amp seal, but the detector can't recognise
 *  it, so each element gets a distinct amp seal that is NOT part of its own base
 *  — that keeps every sequence free of back-to-back duplicates.)
 */
const BASE: Record<SkillElement, string[]> = {
  FIRE: ["ox", "hare", "rat"],
  EARTH: ["dragon", "tiger", "dog"],
  WATER: ["ram", "monkey", "snake"],
};
const AMP: Record<SkillElement, string> = { FIRE: "boar", EARTH: "bird", WATER: "horse" };

const attack = (element: SkillElement, level: SkillLevel): SkillDef => {
  const seals = level === 1 ? [...BASE[element]] : [...BASE[element], AMP[element]];
  return {
    id: `${element.toLowerCase()}_${level}`,
    name: `${title(element)} Attack · Level ${level}`,
    nameJa: element,
    seals,
    action: "ATTACK",
    element,
    level,
    damage: DAMAGE[level],
    image: `img/ninjutsu/${title(element)}/${title(element)}${level}.png`,
  };
};

function title(element: SkillElement): string {
  return element[0] + element.slice(1).toLowerCase();
}

export const SKILLS: SkillDef[] = [
  attack("FIRE", 1),
  attack("FIRE", 2),

  attack("EARTH", 1),
  attack("EARTH", 2),

  attack("WATER", 1),
  attack("WATER", 2),

  {
    id: "shield",
    name: "Shield",
    nameJa: "SHIELD",
    seals: ["gassho"],
    action: "SHIELD",
    element: null,
    level: null,
    damage: 0,
    image: null,
  },
];

/** the seal you hold to sustain the shield (was 壬, now 巳) */
export const SHIELD_HOLD_SIGN = "snake";

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
export const skillById = (id: string): SkillDef | undefined => BY_ID.get(id);
export const MAX_SEAL_SEQUENCE = Math.max(...SKILLS.map((s) => s.seals.length));

/**
 * The shortest skill whose seal sequence begins with `ids` — i.e. the jutsu the
 * player is currently forming. Sequences don't overlap, so this is unambiguous
 * (L1 and its L2 extension share a prefix; the shorter one is returned).
 */
export function skillForPrefix(ids: string[]): SkillDef | undefined {
  if (ids.length === 0) return undefined;
  return [...SKILLS]
    .filter(
      (s) => s.seals.length >= ids.length && ids.every((id, i) => s.seals[i] === id),
    )
    .sort((a, b) => a.seals.length - b.seals.length)[0];
}
