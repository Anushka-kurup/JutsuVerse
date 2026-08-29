export interface PlayerPublic {
  player_id: string;
  hp: number;
  energy: number;
  alive: boolean;
  current_sign: string;
  active_effect: "REFLECT" | "PROTECT" | null;
  reflect_uses_left: number;
  protect_uses_left: number;
}

export interface MatchPublic {
  p1: PlayerPublic;
  p2: PlayerPublic;
  winner: string | null;
  log: string[];
}

export type ServerMessage =
  | { type: "state"; match: MatchPublic }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "sign"; sign: string }
  | { type: "reset" };

export interface SignDef {
  sign: string;
  label: string;
  kind: "ATTACK" | "REFLECT" | "PROTECT";
}

export const SIGNS: SignDef[] = [
  { sign: "TIGER", label: "Tiger → Fire", kind: "ATTACK" },
  { sign: "SNAKE", label: "Snake → Water", kind: "ATTACK" },
  { sign: "BIRD", label: "Bird → Wind", kind: "ATTACK" },
  { sign: "RAM", label: "Ram → Reflect", kind: "REFLECT" },
  { sign: "BOAR", label: "Boar → Protect", kind: "PROTECT" },
];
