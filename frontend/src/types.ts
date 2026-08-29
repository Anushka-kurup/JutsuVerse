import { SIGNS, type Sign } from "@jutsu/protocol";

export interface SignDef {
  sign: Sign;
  label: string;
  key: string;
}

export const SIGN_DEFS: SignDef[] = [
  { sign: "TIGER", label: "Tiger", key: "A" },
  { sign: "SNAKE", label: "Snake", key: "S" },
  { sign: "RAM", label: "Ram", key: "W" },
  { sign: "BOAR", label: "Boar", key: "D" },
  { sign: "BIRD", label: "Bird", key: "F" },
  { sign: "OX", label: "Ox", key: "G" },
];

export const MOVE_HINTS = [
  { seq: "TIGER SNAKE RAM", name: "tiger" },
  { seq: "SNAKE RAM TIGER", name: "serpent" },
  { seq: "RAM TIGER BOAR", name: "ox" },
  { seq: "TIGER BOAR RAM", name: "boar" },
  { seq: "BIRD OX TIGER", name: "crane" },
  { seq: "OX BOAR BIRD", name: "hare" },
  { seq: "BIRD TIGER OX", name: "dragon" },
  { seq: "BOAR SNAKE", name: "guard" },
];

export const PLAYABLE = new Set<string>(SIGNS);

export const KEY_MAP: Record<string, Sign> = {
  a: "TIGER",
  s: "SNAKE",
  w: "RAM",
  d: "BOAR",
  f: "BIRD",
  g: "OX",
  A: "TIGER",
  S: "SNAKE",
  W: "RAM",
  D: "BOAR",
  F: "BIRD",
  G: "OX",
};
