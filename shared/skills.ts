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

const attack = (
  element: SkillElement,
  level: SkillLevel,
  seals: string[],
): SkillDef => ({
  id: `${element.toLowerCase()}_${level}`,
  name: `${title(element)} Attack · Level ${level}`,
  nameJa: element,
  seals,
  action: "ATTACK",
  element,
  level,
  damage: DAMAGE[level],
  image: `img/ninjutsu/${title(element)}/${title(element)}${level}.png`,
});

function title(element: SkillElement): string {
  return element[0] + element.slice(1).toLowerCase();
}

export const SKILLS: SkillDef[] = [
  attack("FIRE", 1, ["rat", "ox", "tiger"]),
  attack("FIRE", 2, ["rat", "ox", "tiger", "ox"]),
  attack("FIRE", 3, ["rat", "ox", "tiger", "ox", "rat"]),

  attack("WIND", 1, ["hare", "dragon", "snake"]),
  attack("WIND", 2, ["hare", "dragon", "snake", "dragon"]),
  attack("WIND", 3, ["hare", "dragon", "snake", "dragon", "hare"]),

  attack("EARTH", 1, ["horse", "ram", "monkey"]),
  attack("EARTH", 2, ["horse", "ram", "monkey", "ram"]),
  attack("EARTH", 3, ["horse", "ram", "monkey", "ram", "horse"]),

  attack("WATER", 1, ["bird", "dog", "boar"]),
  attack("WATER", 2, ["bird", "dog", "boar", "dog"]),
  attack("WATER", 3, ["bird", "dog", "boar", "dog", "bird"]),

  {
    id: "shield",
    name: "Shield",
    nameJa: "SHIELD",
    seals: ["Gassho"],
    action: "SHIELD",
    element: null,
    level: null,
    damage: 0,
    image: null,
  },
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
export const skillById = (id: string): SkillDef | undefined => BY_ID.get(id);
export const MAX_SEAL_SEQUENCE = Math.max(...SKILLS.map((s) => s.seals.length));
