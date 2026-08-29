import { z } from "zod";

export const SIGNS = ["TIGER", "SNAKE", "RAM", "BOAR", "BIRD", "OX"] as const;
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
export const MAX_HP = 6;

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

export const ReadyMsg = z.object({ type: z.literal("ready") });
export const LeaveMsg = z.object({ type: z.literal("leave") });

export const ClientMsg = z.discriminatedUnion("type", [
  JoinMsg,
  SignalMsg,
  InputMsg,
  ReadyMsg,
  LeaveMsg,
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

export const FighterPublicSchema = z.object({
  hp: z.number().int(),
  stance: StanceSchema,
  moveId: z.string().nullable(),
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
    }
  | { type: "error"; code: string; message: string };
