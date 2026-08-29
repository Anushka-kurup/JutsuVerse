import { bus, Events } from "../core/EventBus";
import { sortForScreen } from "../lab/geometry";
import { HandPairer } from "../lab/pairing";
import { Ema, rawSignal } from "../lab/signal";
import { detect, initTracker, type Hand } from "../lab/tracker";
import {
  initialState,
  reset as resetCounter,
  step as countStep,
  type Pose,
} from "../lab/counter";

const EMA_ALPHA = 0.5; // matches the lab: heavier smoothing lags and caps rep rate
const STALE_MS = 500; // hands gone this long → the held average is a lie, drop it

/**
 * Module 3 — the 6-7 rep counter, used only while the match is in the `special`
 * phase.
 *
 * This is a second, completely different detector from the YOLOX seal model:
 * MediaPipe hand *landmarks*, not sign classification. Both read the same
 * <video>, so BattleScene pauses `GestureBridge` for the duration rather than
 * running two models against one camera at once.
 *
 * The detection maths is not reimplemented here — pairing, signal extraction and
 * the Schmitt-trigger counter are the modules from `src/lab/`, whose constants
 * were swept against labelled 20-rep recordings. Reusing them means the contest
 * counts exactly what the detection lab was validated to count.
 */
export class SixSevenBridge {
  private raf = 0;
  private running = false;
  private lastVideoTime = -1;
  private lastValidAt = 0;
  private reported = -1;

  private readonly pairer = new HandPairer();
  private readonly ema = new Ema(EMA_ALPHA);
  private readonly counter = initialState();

  constructor(private readonly video: HTMLVideoElement) {}

  get active(): boolean {
    return this.running;
  }

  get reps(): number {
    return this.counter.reps;
  }

  /**
   * Fetch the landmark model ahead of time. The contest starts on a server tick
   * with no warning, so paying the download there would cost the player reps.
   */
  async preload(): Promise<void> {
    await initTracker();
  }

  async start(): Promise<void> {
    if (this.running) return;
    await initTracker();
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
    resetCounter(this.counter);
    this.pairer.reset();
    this.ema.reset();
    this.lastVideoTime = -1;
    this.lastValidAt = 0;
    this.reported = -1;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    // MediaPipe rejects a repeated timestamp, so only run on a fresh video frame
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const now = performance.now();
    this.process(detect(this.video, now).hands, now);
  };

  /** Identical pipeline to the lab's `processFrame`, minus the diagnostics UI. */
  private process(rawHands: Hand[], now: number): void {
    const paired = this.pairer.update(sortForScreen(rawHands), now);
    const signal = rawSignal(paired.complete ? [paired.a!, paired.b!] : []);

    if (signal.valid) {
      // a long blackout means the smoothed value is stale and would jerk the signal
      if (now - this.lastValidAt > STALE_MS) this.ema.reset();
      this.lastValidAt = now;
    }
    const d = signal.valid ? this.ema.push(signal.raw) : this.ema.value;

    countStep(this.counter, d, signal.valid, now);
    if (this.counter.reps !== this.reported) {
      this.reported = this.counter.reps;
      bus.emit(Events.SIXSEVEN_REPS, this.counter.reps);
    }

    bus.emit(Events.SIXSEVEN_SIGNAL, {
      d,
      valid: signal.valid,
      pose: this.counter.pose,
    } as SixSevenSignal);
  }
}

export interface SixSevenSignal {
  /** height difference in hand spans; sign says which hand is up */
  d: number;
  /** false when fewer than two hands are tracked — nothing can be counted */
  valid: boolean;
  pose: Pose;
}
