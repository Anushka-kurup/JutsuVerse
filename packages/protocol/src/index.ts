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
  "gassho",
  "mizunoe",
] as const;
export type Sign = (typeof SIGNS)[number];
export const SignSchema = z.enum(SIGNS);

export const EDGES = ["down", "up"] as const;
export type Edge = (typeof EDGES)[number];
export const EdgeSchema = z.enum(EDGES);

export const SEATS = ["a", "b"] as const;
export type Seat = (typeof SEATS)[number];
export const SeatSchema = z.enum(SEATS);

export const PHASES = ["waiting", "connecting", "live", "ended"] as const;
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
export const MAX_HP = 100;
export const MAX_ENERGY = 100;
export const ENERGY_REGEN_PER_TICK = 0.5; // ~10 / sec at 20 Hz

export const JoinMsg = z.object({
  type: z.literal("join"),
  code: z.string().min(1).max(8).optional(),
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

/** two-stage ready: "camera" = local camera is on, "start" = pressed Start */
export const READY_STAGES = ["camera", "start"] as const;
export type ReadyStage = (typeof READY_STAGES)[number];
export const ReadyMsg = z.object({
  type: z.literal("ready"),
  stage: z.enum(READY_STAGES).default("camera"),
});
export const ResetMsg = z.object({ type: z.literal("reset") });
export const LeaveMsg = z.object({ type: z.literal("leave") });

export const ClientMsg = z.discriminatedUnion("type", [
  JoinMsg,
  SignalMsg,
  InputMsg,
  ReadyMsg,
  ResetMsg,
  LeaveMsg,
]);
export type ClientMsg = z.infer<typeof ClientMsg>;
export type ReadyMsg = z.infer<typeof ReadyMsg>;

export const FighterPublicSchema = z.object({
  hp: z.number(),
  energy: z.number(),
  stance: StanceSchema,
  /** id of the command (jutsu) currently being performed, or null */
  moveId: z.string().nullable(),
  /** id of the last jutsu that activated — for the cast banner */
  lastSkill: z.string().nullable(),
  lastSkillTick: z.number(),
  /** committed seal sequence still inside the match window */
  buffer: z.array(SignSchema),
  held: z.array(SignSchema),
  guardLeft: z.number().int(),
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
    }
  | { type: "error"; code: string; message: string };
