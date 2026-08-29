import type { Hand } from "./tracker";
import { palmCenter, handSpan } from "./geometry";

// ── the whole gesture, reduced to one number ─────────────────────
// d = (B.y - A.y) / handSpan, where A is the left hand on screen and B the right.
// Image y grows downward, so d > 0 means A is held HIGHER than B.
// Dividing by hand span makes d scale-invariant: it is measured in "hand spans",
// so the same motion gives the same d whether the player sits close or far.

export interface Signal {
  d: number;        // smoothed, normalised height difference (hand spans)
  raw: number;      // same, before smoothing
  scale: number;    // mean hand span this frame, in normalised image units
  valid: boolean;   // false when fewer than two hands were tracked
}

export const INVALID: Signal = { d: 0, raw: 0, scale: 0, valid: false };

export function rawSignal(hands: Hand[]): Signal {
  if (hands.length < 2) return INVALID;

  const [A, B] = hands;
  const scale = (handSpan(A) + handSpan(B)) / 2;
  // a degenerate span means a badly mangled detection; treat it as no reading
  if (scale < 1e-4) return INVALID;

  const raw = (palmCenter(B).y - palmCenter(A).y) / scale;
  return { d: raw, raw, scale, valid: true };
}

// Exponential moving average. Deliberately light: heavy smoothing lags the
// signal, and lag directly caps how fast a player can be counted.
export class Ema {
  private v: number | null = null;
  constructor(private alpha: number) {}

  push(x: number): number {
    this.v = this.v === null ? x : this.v + (x - this.v) * this.alpha;
    return this.v;
  }

  get value(): number {
    return this.v ?? 0;
  }

  reset(): void {
    this.v = null;
  }
}
