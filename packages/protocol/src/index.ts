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

export const PHASES = ["waiting", "connecting", "countdown", "live", "ended"] as const;
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
export const MAX_HP = 20;
export const MAX_SHIELDS = 3;
export const COUNTDOWN_TICKS = TICK_HZ * 4;
export const CLASH_WINDOW_TICKS = TICK_HZ;
export const SHIELD_MAX_TICKS = TICK_HZ * 3;

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
export const LeaveMsg = z.object({ type: z.literal("leave") });

export const ClientMsg = z.discriminatedUnion("type", [
  JoinMsg,
  SignalMsg,
  InputMsg,
  HoldMsg,
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
      /** 3, 2, 1, or 0 while the authoritative countdown is running. */
      countdown?: number | null;
    }
  | { type: "error"; code: string; message: string };
