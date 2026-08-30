import { z } from "zod";

// ── hand seals ──────────────────────────────────────────────────────
// The 14 castable zodiac seals (matches frontend shared/handSigns.ts ids).
export const SIGNS = [
  "rat",
  "ox",
  "tiger",
  "hare",
  "dragon",
  "snake",
  "horse",
  "ram",
  "monkey",
  "bird",
  "dog",
  "boar",
  "mizunoe",
  "gassho",
] as const;
export type Sign = (typeof SIGNS)[number];
export const SignSchema = z.enum(SIGNS);

export const EDGES = ["down", "up"] as const;
export type Edge = (typeof EDGES)[number];
export const EdgeSchema = z.enum(EDGES);

export const SEATS = ["a", "b"] as const;
export type Seat = (typeof SEATS)[number];
export const SeatSchema = z.enum(SEATS);

export const PHASES = [
  "waiting",
  "connecting",
  /** a random meme gesture is shown; first player to perform it starts the match */
  "memegate",
  "live",
  /** the 6-7 rep contest — a one-time last stand opened by the first killing
   * blow of the match; the race winner heals SPECIAL_HEAL (a downed winner
   * revives to it) and fights on, the loser is left where they were */
  "special",
  /** a recurring meme-gesture race: combat freezes every MEME_RACE_TRIGGER_ATTACKS
   * casts — first to perform any trained gesture heals MEME_RACE_HEAL HP */
  "memerace",
  "ended",
] as const;
export type Phase = (typeof PHASES)[number];

export const STANCES = [
  "idle",
  "startup",
  "active",
  "recover",
  "block",
  "hitstun",
] as const;
export type Stance = (typeof STANCES)[number];
export const StanceSchema = z.enum(STANCES);

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const INPUT_DELAY_TICKS = 2;
export const MAX_HP = 30;
export const MAX_SHIELDS = 3;
export const CLASH_WINDOW_TICKS = TICK_HZ;
export const SHIELD_MAX_TICKS = TICK_HZ * 3;

// ── 6-7 special contest ─────────────────────────────────────────────
/** Retained for reference/tuning — no longer a trigger. The contest now opens
 * as a one-time last stand on the first killing blow of the match. */
export const SPECIAL_TRIGGER_ATTACKS = 10;
/** Reps to win outright. One rep = one confirmed alternation (see lab/counter.ts). */
export const SPECIAL_TARGET_REPS = 67;
/** HP the race winner is restored to / by (a last-stand winner at ≤0 revives to this). */
export const SPECIAL_HEAL = 10;
/** Hard cap; whoever leads on reps when it expires wins. Never let a match hang. */
export const SPECIAL_MAX_TICKS = TICK_HZ * 60;
/** How long the result banner keeps riding along after the contest resolves. */
export const SPECIAL_BANNER_TICKS = TICK_HZ * 3;

// ── meme-gesture challenges (memegate starts a match; memerace is a recurring bonus) ──
/** Countdown for the pre-match gate. On expiry the match just starts, with no
 * bonus; performing the gesture before it runs out earns MEME_GATE_BONUS_HP. */
export const MEME_GATE_MAX_TICKS = TICK_HZ * 10;
/** Extra starting HP (on top of MAX_HP) for the player who performs the gate
 * gesture first — 35 vs the usual 30. */
export const MEME_GATE_BONUS_HP = 5;
/** Combined casts by BOTH fighters that open a meme race. It yields the slot to
 * the 6-7 contest, so races land on casts 5, 15, 25… and 6-7 on 10, 20, 30…. */
export const MEME_RACE_TRIGGER_ATTACKS = 5;
/** HP restored to whoever performs a trained gesture first in the meme race. */
export const MEME_RACE_HEAL = 1;
/** Hard cap for the meme race; nobody managing it resolves as a no-op draw. */
export const MEME_RACE_MAX_TICKS = TICK_HZ * 10;
/** How long the result banner keeps riding along after the race resolves. */
export const MEME_BANNER_TICKS = TICK_HZ * 3;

export const JoinMsg = z.object({
  type: z.literal("join"),
  code: z.string().min(1).max(3).optional(),
  name: z.string().min(1).max(24).optional(),
});

export const SignalMsg = z.object({
  type: z.literal("signal"),
  payload: z.unknown(),
});

export const InputMsg = z.object({
  type: z.literal("input"),
  seq: z.number().int().nonnegative(),
  sign: SignSchema,
  edge: EdgeSchema,
  tClient: z.number(),
});
export type InputMsg = z.infer<typeof InputMsg>;

/** Current valid gesture, used to prove the final shield sign is maintained. */
export const HoldMsg = z.object({
  type: z.literal("hold"),
  seq: z.number().int().nonnegative(),
  sign: SignSchema.nullable(),
  tClient: z.number(),
});
export type HoldMsg = z.infer<typeof HoldMsg>;

/** Lobby gates plus the post-game per-player rematch readiness. */
export const READY_STAGES = ["camera", "start", "rematch"] as const;
export type ReadyStage = (typeof READY_STAGES)[number];
export const ReadyMsg = z.object({
  type: z.literal("ready"),
  stage: z.enum(READY_STAGES).default("camera"),
  enabled: z.boolean().optional(),
});
/**
 * Rep count during the 6-7 contest. The camera is on the client, so the count is
 * detected there and reported here; the server only arbitrates who got to the
 * target first. It clamps to monotonic growth, so a client cannot walk it back.
 */
export const RepsMsg = z.object({
  type: z.literal("reps"),
  seq: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative().max(10_000),
  tClient: z.number(),
});
export type RepsMsg = z.infer<typeof RepsMsg>;

/**
 * A confirmed meme gesture during memegate or memerace. Detected client-side
 * (frontend/src/gesture/MemeBridge.ts); the server just checks whether it
 * matches the currently active label and, if so, whether this seat is the
 * first to report it.
 */
export const MemeMsg = z.object({
  type: z.literal("meme"),
  seq: z.number().int().nonnegative(),
  label: z.string().min(1).max(64),
});
export type MemeMsg = z.infer<typeof MemeMsg>;

export const LeaveMsg = z.object({ type: z.literal("leave") });

export const ClientMsg = z.discriminatedUnion("type", [
  JoinMsg,
  SignalMsg,
  InputMsg,
  HoldMsg,
  RepsMsg,
  MemeMsg,
  ReadyMsg,
  LeaveMsg,
]);
export type ClientMsg = z.infer<typeof ClientMsg>;
export type ReadyMsg = z.infer<typeof ReadyMsg>;

export const FighterPublicSchema = z.object({
  hp: z.number(),
  shields: z.number().int(),
  stance: StanceSchema,
  /** id of the command (jutsu) currently being performed, or null */
  moveId: z.string().nullable(),
  /** id of the last jutsu that activated — for the cast banner */
  lastSkill: z.string().nullable(),
  lastSkillTick: z.number(),
  /** up to five committed seals, with consecutive duplicates removed */
  buffer: z.array(SignSchema).max(5),
  held: z.array(SignSchema),
  guardLeft: z.number().int(),
  shieldActive: z.boolean(),
});
export type FighterPublic = z.infer<typeof FighterPublicSchema>;

/** The 6-7 contest as both clients see it. */
export interface SpecialPublic {
  reps: { a: number; b: number };
  target: number;
  /** ticks remaining before the cap expires; 0 once resolved */
  ticksLeft: number;
  /** null while running, then the seat that won (or a draw) */
  winner: Seat | "draw" | null;
  /** HP actually restored to the winner — 0 on a draw or if they were already full */
  healed: number;
}

/**
 * A meme-gesture challenge as both clients see it — the pre-match memegate or a
 * mid-battle memerace.
 */
export interface MemeChallengePublic {
  label: string;
  /** web path of the meme image under BASE_URL (e.g. "memes/img/dab.jpeg"); "" if none */
  image: string;
  /** ticks remaining before the hard cap; 0 once resolved */
  ticksLeft: number;
  /** which seats have already performed the label */
  done: { a: boolean; b: boolean };
  /** null while running; a "draw" only ever comes from a memerace timeout */
  winner: Seat | "draw" | null;
  /** HP actually restored — 0 for memegate, and 0 if already at full health */
  healed: number;
}

export type ServerMsg =
  | {
      type: "joined";
      playerId: string;
      seat: Seat;
      code: string;
      peerPresent: boolean;
      name: string;
    }
  | { type: "peer_joined"; seat: Seat; name: string }
  | { type: "peer_left"; seat: Seat }
  | { type: "signal"; from: Seat; payload: unknown }
  | { type: "state"; tick: number; a: FighterPublic; b: FighterPublic }
  | {
      type: "match_state";
      phase: Phase;
      winner?: Seat | "draw" | null;
      /** per-seat gate flags so clients can say "waiting for opponent" */
      cam?: { a: boolean; b: boolean };
      ready?: { a: boolean; b: boolean };
      /** present during the 6-7 contest and for a few ticks after it resolves */
      special?: SpecialPublic;
      /** present during memegate/memerace and for a few ticks after a race resolves */
      memeChallenge?: MemeChallengePublic;
    }
  | { type: "error"; code: string; message: string };
