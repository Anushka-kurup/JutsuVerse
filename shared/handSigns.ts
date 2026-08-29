/**
 * Hand-sign vocabulary for frontend/public/models/yolox_nano.onnx
 * (from https://github.com/Kazuhito00/NARUTO-HandSignDetection).
 *
 * INDEX = the model's RAW class id.  In that repo's demos the raw class id is
 * used as `labels.csv[class_id + 1]` — row 0 of labels.csv (`None,無`) is a dummy
 * that only exists to make the +1 land right.  So raw class 0 is Rat, not None,
 * and this array is labels.csv rows 1..16 with the +1 already folded in.
 *
 *   raw 0→子 Rat   raw 1→丑 Ox     raw 2→寅 Tiger   raw 3→卯 Hare
 *   raw 4→辰 Dragon raw 5→巳 Snake  raw 6→午 Horse   raw 7→未 Ram
 *   raw 8→申 Monkey raw 9→酉 Bird   raw 10→戌 Dog    raw 11→亥 Boar
 *   raw 12→祈 Gassho raw 13→謎 Unknown  raw 14→壬 Mizunoe
 *
 * The ONNX head emits 16 class slots (output [1,3549,21] → 21-5); only 0..14 are
 * real, index 15 is a spare the model effectively never fires.
 */
export interface HandSign {
  /** stable lowercase id used everywhere in code + asset filenames */
  id: string;
  /** kanji shown as the text fallback when no image exists */
  kanji: string;
  /** english zodiac name */
  en: string;
}

export const HAND_SIGNS: HandSign[] = [
  { id: "rat", kanji: "子", en: "Rat" }, // 0
  { id: "ox", kanji: "丑", en: "Ox" }, // 1
  { id: "tiger", kanji: "寅", en: "Tiger" }, // 2
  { id: "hare", kanji: "卯", en: "Hare" }, // 3
  { id: "dragon", kanji: "辰", en: "Dragon" }, // 4
  { id: "snake", kanji: "巳", en: "Snake" }, // 5
  { id: "horse", kanji: "午", en: "Horse" }, // 6
  { id: "ram", kanji: "未", en: "Ram" }, // 7
  { id: "monkey", kanji: "申", en: "Monkey" }, // 8
  { id: "bird", kanji: "酉", en: "Bird" }, // 9
  { id: "dog", kanji: "戌", en: "Dog" }, // 10
  { id: "boar", kanji: "亥", en: "Boar" }, // 11
  { id: "gassho", kanji: "祈", en: "Gassho" }, // 12
  { id: "unknown", kanji: "謎", en: "Unknown" }, // 13
  { id: "mizunoe", kanji: "壬", en: "Mizunoe" }, // 14
  { id: "none", kanji: "—", en: "None" }, // 15 — spare slot, effectively never emitted
];

const BY_ID = new Map(HAND_SIGNS.map((s) => [s.id, s]));

export const signByIndex = (i: number): HandSign | undefined => HAND_SIGNS[i];
export const signById = (id: string): HandSign | undefined => BY_ID.get(id);

/** ids that are real, castable seals (excludes the none/unknown display helpers) */
export const SEAL_IDS = HAND_SIGNS.filter(
  (s) => s.id !== "none" && s.id !== "unknown",
).map((s) => s.id);

export const isSeal = (id: string): boolean => id !== "none" && id !== "unknown" && BY_ID.has(id);
