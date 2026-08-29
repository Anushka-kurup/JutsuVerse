/**
 * Wire protocol shared by the Socket.io server and the Phaser client.
 * Both `server/` and `frontend/` import this file so the two stay in lockstep.
 */

// ── authoritative match snapshot (server → all clients, ~10×/s) ──────
export interface PlayerPublic {
  player_id: string;
  hp: number;
  energy: number;
  alive: boolean;

  /** live sign the detector is currently seeing on this player (hand-sign id, or "none") */
  current_sign: string;
  /** committed seals this player has formed so far, in order (cleared on cast / timeout) */
  seal_buffer: string[];
  /** id of the last skill this player successfully cast, or null */
  last_skill: string | null;
  /** server timestamp (seconds) of that cast — clients use it to time the banner out */
  last_skill_at: number;

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

export type Element = "FIRE" | "WATER" | "WIND";

// ── webrtc signaling payloads (server just relays these verbatim) ────
export interface OfferMsg {
  sdp: RTCSessionDescriptionInit;
}
export interface AnswerMsg {
  sdp: RTCSessionDescriptionInit;
}
export interface IceMsg {
  candidate: RTCIceCandidateInit;
}

// ── Socket.io event maps ────────────────────────────────────────────
export interface ServerToClientEvents {
  state: (match: MatchPublic) => void;
  /** connection refused (room full, missing room/player) — client should stop */
  rejected: (msg: { message: string }) => void;
  "webrtc-peer": (msg: { peer_id: string; initiator: boolean }) => void;
  "webrtc-offer": (msg: OfferMsg) => void;
  "webrtc-answer": (msg: AnswerMsg) => void;
  "webrtc-ice": (msg: IceMsg) => void;
}

export interface ClientToServerEvents {
  /** the live sign under the camera right now (hand-sign id or "none") — sets current_sign */
  seal: (msg: { sign: string }) => void;
  /** the client's authoritative committed seal sequence — mirrored so the opponent can watch */
  seals: (msg: { buffer: string[] }) => void;
  /** the client's SkillMatcher completed a sequence — server validates + resolves */
  cast_skill: (msg: { skillId: string }) => void;
  reset: () => void;
  "webrtc-offer": (msg: OfferMsg) => void;
  "webrtc-answer": (msg: AnswerMsg) => void;
  "webrtc-ice": (msg: IceMsg) => void;
}

/** Passed by the client in `io(url, { auth })` and read from `socket.handshake.auth`. */
export interface HandshakeAuth {
  room: string;
  player: string;
}
