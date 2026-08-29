import type { Hand } from "./tracker";
import { palmCenter } from "./geometry";

// ── stable hand slots with short-gap bridging ────────────────────
// Two jobs, both needed before the signal is usable:
//
// 1. Keep a hand in the SAME slot frame to frame. Re-sorting by x every frame
//    lets the slots swap whenever the hands pass close together, which flips
//    the sign of d instantly and fakes a huge flip.
// 2. Bridge one-hand frames. MediaPipe loses a blurred hand mid-swing
//    constantly; holding its last position for a few frames keeps the signal
//    continuous instead of shredding it into fragments.

const HOLD_MS = 100;   // ~3 frames at 30fps; past this the held position is a lie

interface Slot {
  hand: Hand;
  x: number;
  t: number;
}

export interface Paired {
  a: Hand | null;
  b: Hand | null;
  heldA: boolean;
  heldB: boolean;
  complete: boolean;   // both slots filled, measured or held
  measured: boolean;   // both slots filled from THIS frame's detection
}

export class HandPairer {
  private slots: [Slot | null, Slot | null] = [null, null];

  reset(): void {
    this.slots = [null, null];
  }

  update(detected: Hand[], now: number): Paired {
    const seen: [Hand | null, Hand | null] = [null, null];

    if (detected.length >= 2) {
      const [h1, h2] = detected;
      const x1 = palmCenter(h1).x;
      const x2 = palmCenter(h2).x;

      if (this.slots[0] && this.slots[1]) {
        // keep continuity: pick whichever assignment moves the hands least
        const straight = Math.abs(x1 - this.slots[0].x) + Math.abs(x2 - this.slots[1].x);
        const swapped = Math.abs(x2 - this.slots[0].x) + Math.abs(x1 - this.slots[1].x);
        [seen[0], seen[1]] = straight <= swapped ? [h1, h2] : [h2, h1];
      } else {
        // no history yet — slot A is the left hand on screen (video is mirrored,
        // so screen-left is the LARGER landmark x)
        [seen[0], seen[1]] = x1 > x2 ? [h1, h2] : [h2, h1];
      }
    } else if (detected.length === 1) {
      const h = detected[0];
      const x = palmCenter(h).x;
      // put it back in whichever slot it was last nearest to
      const dA = this.slots[0] ? Math.abs(x - this.slots[0].x) : Infinity;
      const dB = this.slots[1] ? Math.abs(x - this.slots[1].x) : Infinity;
      if (dA === Infinity && dB === Infinity) seen[0] = h;
      else if (dA <= dB) seen[0] = h;
      else seen[1] = h;
    }

    for (let i = 0; i < 2; i++) {
      const h = seen[i];
      if (h) this.slots[i] = { hand: h, x: palmCenter(h).x, t: now };
    }

    const resolve = (i: 0 | 1): { hand: Hand | null; held: boolean } => {
      if (seen[i]) return { hand: seen[i], held: false };
      const slot = this.slots[i];
      if (slot && now - slot.t <= HOLD_MS) return { hand: slot.hand, held: true };
      return { hand: null, held: false };
    };

    const A = resolve(0);
    const B = resolve(1);

    return {
      a: A.hand,
      b: B.hand,
      heldA: A.held,
      heldB: B.held,
      complete: A.hand !== null && B.hand !== null,
      measured: seen[0] !== null && seen[1] !== null,
    };
  }
}
