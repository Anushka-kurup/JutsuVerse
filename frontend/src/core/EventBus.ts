import Phaser from "phaser";

/**
 * App-wide event bus.
 *
 *   GestureBridge ─SIGN_LIVE→ SkillMatcher ─SEAL_CONFIRMED→ NetworkClient (input edge)
 *   NetworkClient ─NET_STATE→ StateSync ─SKILL_FIRED / OPP_SEALS / …→ scene + overlay
 *
 * The server owns all game logic now (sequence matching, damage, energy). The
 * client just streams confirmed seals as input edges and renders the state.
 */
export const bus = new Phaser.Events.EventEmitter();

export const Events = {
  // ── player intent (DOM overlay → app) ──
  CONNECT_REQUEST: "connect-request", // (ConnectOpts)
  RESET_REQUEST: "reset-request",

  // ── gesture module (single-frame detection) ──
  SIGN_LIVE: "sign-live", // ({ id: string | null, score: number })

  // ── sequence module — just confirms a seal, the server matches ──
  SEAL_CONFIRMED: "seal-confirmed", // (id: string) — held steady long enough → send it
  SEAL_BUFFER: "seal-buffer", // (ids: string[]) — my seals still in the server's window
  MY_HELD: "my-held", // (id: string | null) — the sign I'm currently forming

  // ── 6-7 contest (MediaPipe rep counter, replaces seal input while it runs) ──
  SIXSEVEN_REPS: "sixseven-reps", // (reps: number) — my local count changed
  SIXSEVEN_SIGNAL: "sixseven-signal", // ({ d, valid, pose }) — live detector feedback

  // ── network module ──
  NET_OPEN: "net-open",
  NET_JOINED: "net-joined", // ({ code: string, seat: Seat, peerPresent: boolean })
  NET_NAMES: "net-names", // ({ me: string, opp: string }) — display names, opp "" until known
  NET_STATE: "net-state", // ({ me: FighterPublic, opp: FighterPublic, tick })
  NET_MATCH: "net-match", // ({ phase, winner })
  NET_ERROR: "net-error", // (message: string)
  NET_CLOSE: "net-close",
  PEER_JOINED: "peer-joined", // () — the other seat is present
  PEER_LEFT: "peer-left", // ()
  WEBRTC_SIGNAL: "webrtc-signal", // (payload: unknown) — opaque offer/answer/ice

  // ── derived battle beats (StateSync reads FighterPublic deltas) ──
  SKILL_FIRED: "skill-fired", // ({ side: Side, skillId: string })
  OPP_SEALS: "opp-seals", // (ids: string[])
  OPP_SIGN: "opp-sign", // (id: string | null)
  DAMAGE: "damage", // ({ side: Side, amount: number })
  DEFENSE: "defense", // ({ side: Side, kind: "REFLECT" | "PROTECT" | null })
  MATCH_OVER: "match-over", // ({ winner: string, iWon: boolean })
} as const;
