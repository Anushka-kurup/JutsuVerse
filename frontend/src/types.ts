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

export interface MemeMatchPublic {
  p1_id: string;
  p2_id: string;
  target: string;
  winner: string | null; // a player_id, or null while the round is live
  win_time_seconds: number | null;
}

export type ServerMessage =
  | { type: "state"; match: MatchPublic }
  | { type: "meme_state"; match: MemeMatchPublic }
  | { type: "error"; message: string }
  | { type: "webrtc-peer"; peer_id: string; initiator: boolean }
  | { type: "webrtc-offer"; sdp: RTCSessionDescriptionInit }
  | { type: "webrtc-answer"; sdp: RTCSessionDescriptionInit }
  | { type: "webrtc-ice"; candidate: RTCIceCandidateInit };

export type ClientMessage =
  | { type: "sign"; sign: string }
  | { type: "meme"; label: string }
  | { type: "reset" }
  | { type: "webrtc-offer"; sdp: RTCSessionDescriptionInit }
  | { type: "webrtc-answer"; sdp: RTCSessionDescriptionInit }
  | { type: "webrtc-ice"; candidate: RTCIceCandidateInit };

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

export interface MemeDef {
  label: string;
  display: string;
}

// order matches labels.csv / the meme classifier's training classes
export const MEME_SIGNS: MemeDef[] = [
  { label: "SIX_SEVEN", display: "6-7" },
  { label: "MOG", display: "Mog" },
  { label: "THINKING_MONKEY", display: "Thinking Monkey" },
  { label: "ITALIAN_HAND", display: "Italian Hand" },
  { label: "KOREAN_HEART", display: "Korean Heart" },
  { label: "SHOCKED_GUY", display: "Shocked Guy" },
  { label: "SCHEMING_HAND", display: "Scheming Hand" },
  { label: "DRAKE_NO", display: "Drake No" },
  { label: "DRAKE_YES", display: "Drake Yes" },
  { label: "SCUBA_OK", display: "Scuba OK" },
  { label: "DAB", display: "Dab" },
];
