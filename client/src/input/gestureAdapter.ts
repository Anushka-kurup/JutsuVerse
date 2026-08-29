import { SIGNS, type Sign } from "@jutsu/protocol";
import type { InputAdapter, SignListener } from "./adapter.ts";
import { detectFrame, drawLandmarks } from "./handTracker.ts";

const HYSTERESIS = 4;

function playable(sign: string): Sign | null {
  return (SIGNS as readonly string[]).includes(sign) ? (sign as Sign) : null;
}

export function createGestureAdapter(opts: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  onLabel?: (label: string) => void;
}): InputAdapter {
  let listener: SignListener | null = null;
  let raf = 0;
  let running = false;
  let candidate: Sign | null = null;
  let candidateCount = 0;
  let held: Sign | null = null;

  const releaseHeld = () => {
    if (held) listener?.({ sign: held, edge: "up" });
    held = null;
    candidate = null;
    candidateCount = 0;
  };

  const step = (now: number) => {
    if (!running) return;
    const { sign, landmarks } = detectFrame(opts.video, now);
    drawLandmarks(opts.canvas, landmarks);
    opts.onLabel?.(sign === "UNKNOWN" ? "—" : sign);

    const next = playable(sign);
    if (next === candidate) candidateCount += 1;
    else {
      candidate = next;
      candidateCount = 1;
    }

    if (candidateCount >= HYSTERESIS && candidate !== held) {
      if (held) listener?.({ sign: held, edge: "up" });
      if (candidate) listener?.({ sign: candidate, edge: "down" });
      held = candidate;
    }

    raf = requestAnimationFrame(step);
  };

  return {
    start(onEdge) {
      listener = onEdge;
      running = true;
      raf = requestAnimationFrame(step);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      releaseHeld();
      listener = null;
    },
  };
}
