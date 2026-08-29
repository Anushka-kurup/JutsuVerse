/**
 * The five jutsu. Every attack is a 3-seal combo; the one defensive jutsu
 * (Clone) is a quick 2-seal.
 *
 * `action` / `element` feed the server's combat engine:
 *   ATTACK + element → damage
 *   PROTECT          → block the next hit
 */
export type SkillAction = "ATTACK" | "REFLECT" | "PROTECT";
export type SkillElement = "FIRE" | "WATER" | "WIND" | "EARTH";

export interface SkillDef {
  id: string;
  name: string; // english
  nameJa: string; // 漢字
  seals: string[]; // hand-sign ids, in cast order (length 3–5)
  action: SkillAction;
  element: SkillElement | null;
}

export const SKILLS: SkillDef[] = [
  {
    id: "clone",
    name: "Clone Jutsu",
    nameJa: "分身の術",
    seals: ["ram", "snake"],
    action: "PROTECT", // decoys soak the next hit — quick 2-seal defence
    element: null,
  },
  {
    id: "fireball",
    name: "Fireball Jutsu",
    nameJa: "火遁・豪火球の術",
    seals: ["snake", "tiger", "horse"],
    action: "ATTACK",
    element: "FIRE",
  },
  {
    id: "water_trumpet",
    name: "Water Trumpet",
    nameJa: "水喇叭",
    seals: ["dragon", "tiger", "hare"],
    action: "ATTACK",
    element: "WATER",
  },
  {
    id: "great_breakthrough",
    name: "Great Breakthrough",
    nameJa: "風遁・大突破",
    seals: ["tiger", "dog", "horse"],
    action: "ATTACK",
    element: "WIND",
  },
  {
    id: "earth_dragon",
    name: "Earth Dragon Bullet",
    nameJa: "土遁・土龍弾",
    seals: ["boar", "ox", "dragon"],
    action: "ATTACK",
    element: "EARTH",
  },
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
export const skillById = (id: string): SkillDef | undefined => BY_ID.get(id);

/** longest skill sequence — how many committed seals the matcher needs to keep */
export const MAX_SEAL_SEQUENCE = Math.max(...SKILLS.map((s) => s.seals.length));
