import { bus, Events } from "../core/EventBus";
import { clipToRow, frameToRow, poseIsUsable } from "./memeFeatures";
import { loadMemeForest, type MemeForest } from "./memeForest";
import { detectMemeFrame, initMemeTracker } from "./memeTracker";

const CLIP_MS = 1500; // must match capture_clips.py's --clip-seconds default
const KEYFRAMES = 8; // must match capture_clips.py's --keyframes default
// The classifier is forced-choice -- every frame gets assigned to ONE of the
// 11 labels, there's no "not a gesture" option. That means someone just
// standing there looking at the screen, doing nothing, still gets scored as
// SOME label, and chance alone is already ~1/11 (9%). A floor of 0.15 is
// barely above that, so it was passing on neutral/idle frames, not just
// weak-but-real attempts (that's the "screen going off just by looking"
// bug). 0.4 sits close to the model's own ~0.33 mean confidence on its
// exact training rows, so it still credits most genuine attempts without
// accepting a near-chance guess made on someone doing nothing at all.
export const MEME_MIN_CONFIDENCE = 0.4;
const NO_SIGNAL_RESET_MS = 300; // a gap this long starts a fresh attempt
// Judging the very first tracked frame is too trigger-happy: it can catch
// someone still raising their hands into position, before they've actually
// formed the gesture. This isn't about requiring several frames to AGREE
// (that was the old, stricter mechanism, and it made a real gesture often
// never get credited at all) -- it's just a minimum runway so a person has
// a moment to settle before anything gets judged.
const MIN_ATTEMPT_MS = 500;
// Two full MediaPipe models (pose + hands) running synchronously on every
// single video frame with no throttle saturates the main thread — that's
// real, felt lag across the whole page, not just this feature. GestureBridge
// (the seal detector) already throttles its one lighter ONNX model to this
// same ~11fps; two heavier models need it at least as much.
const DETECT_INTERVAL_MS = 90;

interface WindowFrame {
  t: number;
  feats: number[];
}

export interface MemeDebugEntry {
  label: string;
  confidence: number;
}

export interface MemeDebug {
  tracked: boolean;
  windowMs: number;
  latched: boolean;
  /** top 5 classes by confidence, recomputed every detection tick regardless
   * of MIN_ATTEMPT_MS/latch gating — for live tuning via the D-key overlay */
  top: MemeDebugEntry[];
}

const EMPTY_DEBUG: MemeDebug = { tracked: false, windowMs: 0, latched: false, top: [] };

/**
 * Client-side meme-gesture recognizer for the memegate/memerace challenges.
 * Mirrors frontend/public/memes/live_predict.py's live windowed classification
 * (see its own docstring): classify the growing clip continuously, reset the
 * window after a brief signal gap, and report a recognition once per attempt.
 *
 * Doesn't gate on a specific target label: per-label detection reliability
 * varies a lot on this dataset (some gestures classify readily, others
 * rarely clear the bar), so requiring the ONE label the challenge happened
 * to show would make it effectively unwinnable whenever that label is a weak
 * one. Instead this reports WHATEVER label wins the very first frame that
 * clears MEME_MIN_CONFIDENCE — the server just needs to know a valid trained
 * gesture was performed, not which one, and awards it to whoever reports first.
 */
export class MemeBridge {
  private raf = 0;
  private running = false;
  private lastVideoTime = -1;
  private lastDetectAt = 0;
  private lastSignalAt = 0;
  private window: WindowFrame[] = [];
  private latched = false;
  private forest: MemeForest | null = null;
  private lastDebug: MemeDebug = EMPTY_DEBUG;

  constructor(private readonly video: HTMLVideoElement) {}

  get active(): boolean {
    return this.running;
  }

  /** Live confidence readout for the D-key debug overlay — see MemeDebug. */
  get debug(): MemeDebug {
    return this.lastDebug;
  }

  /** Call whenever a new challenge attempt begins (including a label re-roll)
   * so stale frames/latching from the previous attempt don't carry over. */
  reset(): void {
    this.latched = false;
    this.window = [];
    this.lastDebug = EMPTY_DEBUG;
  }

  /** Fetch the models ahead of time — the gate/race starts with no warning. */
  async preload(): Promise<void> {
    await Promise.all([
      initMemeTracker(),
      this.forest ? Promise.resolve() : loadMemeForest().then((f) => (this.forest = f)),
    ]);
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.preload();
    this.resetState();
    this.running = true;
    this.loop();
  }

  stop(): void {
    if (!this.running) return;
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.resetState();
  }

  private resetState(): void {
    this.reset();
    this.lastVideoTime = -1;
    this.lastDetectAt = 0;
    this.lastSignalAt = 0;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    // MediaPipe rejects a repeated timestamp, so only run on a fresh video frame
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const now = performance.now();
    if (now - this.lastDetectAt < DETECT_INTERVAL_MS) return;
    this.lastDetectAt = now;

    const frame = detectMemeFrame(this.video, now);
    const tracked = poseIsUsable(frame.pose) || Boolean(frame.leftHand) || Boolean(frame.rightHand);
    bus.emit(Events.MEME_SIGNAL, { tracked });

    if (tracked) {
      this.lastSignalAt = now;
      const w = this.video.videoWidth || 640;
      const h = this.video.videoHeight || 480;
      this.window.push({ t: now, feats: frameToRow(frame.pose, frame.leftHand, frame.rightHand, w, h) });
    } else if (this.lastSignalAt && now - this.lastSignalAt > NO_SIGNAL_RESET_MS) {
      // the gesture attempt ended — the next signal starts a fresh one
      this.window = [];
      this.latched = false;
    }
    this.window = this.window.filter((p) => now - p.t <= CLIP_MS);

    // recomputed every tick regardless of the gates below, so the D-key debug
    // overlay shows live confidence even before MIN_ATTEMPT_MS or after latch
    let top: MemeDebugEntry[] = [];
    if (this.window.length && this.forest) {
      const row = clipToRow(this.window.map((p) => p.feats), KEYFRAMES);
      const proba = this.forest.predictProba(row);
      top = this.forest.labels
        .map((label, i) => ({ label, confidence: proba[i] }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5);
    }
    this.lastDebug = {
      tracked,
      windowMs: this.window.length ? now - this.window[0].t : 0,
      latched: this.latched,
      top,
    };

    if (!this.window.length || !this.forest || this.latched) return;
    if (now - this.window[0].t < MIN_ATTEMPT_MS) return; // give them a moment to get into it

    const best = top[0];
    if (best && best.confidence >= MEME_MIN_CONFIDENCE) {
      this.latched = true;
      bus.emit(Events.MEME_RECOGNIZED, { label: best.label });
    }
  };
}
