/**
 * The five jutsu. Each is a sequence of 3–5 hand-sign ids (see handSigns.ts).
 * Four sequences are taken from jutsu.csv in Kazuhito00/NARUTO-HandSignDetection
 * (Fireball trimmed 6→5); "Great Breakthrough" is the canonical wind jutsu,
 * added so the FIRE→WIND→WATER→FIRE clash triangle is fully covered.
 *
 * `action` / `element` feed straight into the server's existing combat engine:
 *   ATTACK + element → damage / clash
 *   REFLECT          → bounce the next hit back
 *   PROTECT          → block the next hit
 */
export type SkillAction = "ATTACK" | "REFLECT" | "PROTECT";
export type SkillElement = "FIRE" | "WATER" | "WIND";

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
    seals: ["ram", "snake", "tiger"],
    action: "REFLECT",
    element: null,
  },
  {
    id: "fireball",
    name: "Fireball Jutsu",
    nameJa: "火遁・豪火球の術",
    seals: ["snake", "ram", "monkey", "horse", "tiger"],
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
    id: "substitution",
    name: "Substitution Jutsu",
    nameJa: "替え身の術",
    seals: ["ram", "boar", "ox", "dog", "snake"],
    action: "PROTECT",
    element: null,
  },
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
export const skillById = (id: string): SkillDef | undefined => BY_ID.get(id);

/** longest skill sequence — how many committed seals the matcher needs to keep */
export const MAX_SEAL_SEQUENCE = Math.max(...SKILLS.map((s) => s.seals.length));
