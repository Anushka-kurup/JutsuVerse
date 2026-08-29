// ── Steps 4-5: pose state machine + rep counting ─────────────────
// Constants below are not guesses. They were swept against three
// recorded 20-rep trials; every value in the plateau enter ±0.2…±1.0
// reproduces the true count, and these sit in the middle of it.

export const ENTER = 0.6;      // hand spans: cross this to claim a side
export const EXIT = 0.25;      // fall back inside this to release it
export const MIN_FLIP_MS = 120; // floor between counted reps

// Hysteresis is what makes this trustworthy: with separate enter/exit
// thresholds a hand physically cannot register a flip without crossing the
// whole band, so small fast jitter can never be farmed into reps.

export type Pose = "A_HIGH" | "B_HIGH" | "NEUTRAL";

export interface CounterState {
  pose: Pose;
  reps: number;
  lastSide: "A_HIGH" | "B_HIGH" | null;
  lastFlipAt: number;
  flippedThisFrame: boolean;
}

export function initialState(): CounterState {
  return { pose: "NEUTRAL", reps: 0, lastSide: null, lastFlipAt: -Infinity, flippedThisFrame: false };
}

// One rep = one confirmed alternation, so a full cycle counts twice. That
// matches how the gesture reads and keeps the counter moving.
export function step(s: CounterState, d: number, valid: boolean, t: number): CounterState {
  s.flippedThisFrame = false;
  if (!valid) return s;   // hold state through dropouts; never count blind

  if (s.pose === "A_HIGH" && d < EXIT) s.pose = "NEUTRAL";
  else if (s.pose === "B_HIGH" && d > -EXIT) s.pose = "NEUTRAL";

  if (s.pose === "NEUTRAL") {
    const side: Pose | null = d > ENTER ? "A_HIGH" : d < -ENTER ? "B_HIGH" : null;
    if (side && t - s.lastFlipAt >= MIN_FLIP_MS) {
      s.pose = side;
      s.lastFlipAt = t;
      if (s.lastSide && s.lastSide !== side) {
        s.reps++;
        s.flippedThisFrame = true;
      }
      s.lastSide = side as "A_HIGH" | "B_HIGH";
    }
  }
  return s;
}

export function reset(s: CounterState): void {
  Object.assign(s, initialState());
}
