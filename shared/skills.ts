export type SkillAction = "ATTACK" | "SHIELD";
export type SkillElement = "FIRE" | "WATER" | "WIND" | "EARTH";
export type SkillLevel = 1 | 2 | 3;

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

const DAMAGE: Record<SkillLevel, number> = { 1: 1, 2: 2, 3: 4 };

/**
 * 3-seal base per element. Level 2 appends one "amp" seal; level 3 appends that
 * same amp seal plus 祈 Gassho.
 * (壬 Mizunoe used to be the shared amp seal, but the detector can't recognise
 *  it, so each element gets a distinct amp seal that is NOT part of its own base
 *  — that keeps every sequence free of back-to-back duplicates.)
 */
const BASE: Record<SkillElement, string[]> = {
  FIRE: ["rat", "ox", "tiger"],
  WIND: ["hare", "dragon", "snake"],
  EARTH: ["horse", "ram", "monkey"],
  WATER: ["bird", "dog", "boar"],
};
const AMP: Record<SkillElement, string> = { FIRE: "dog", WIND: "monkey", EARTH: "dragon", WATER: "tiger" };

const attack = (element: SkillElement, level: SkillLevel): SkillDef => {
  const seals =
    level === 1
      ? [...BASE[element]]
      : level === 2
        ? [...BASE[element], AMP[element]]
        : [...BASE[element], AMP[element], "gassho"];
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
  attack("FIRE", 3),

  attack("WIND", 1),
  attack("WIND", 2),
  attack("WIND", 3),

  attack("EARTH", 1),
  attack("EARTH", 2),
  attack("EARTH", 3),

  attack("WATER", 1),
  attack("WATER", 2),
  attack("WATER", 3),

  {
    id: "shield",
    name: "Shield",
    nameJa: "SHIELD",
    seals: ["gassho", "snake"], // hold 巳 Snake to keep the shield up
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
