import { bus, Events } from "../core/EventBus";
import { startCamera, stopCamera } from "./camera";
import { drawDetection, YoloxHandSign, type DetectDebug } from "./YoloxHandSign";

const DETECT_INTERVAL_MS = 90; // ~11 fps — plenty for seal timing, keeps ONNX cost sane

/**
 * Module 1 owner: opens the webcam, runs the YOLOX detector on a throttled loop,
 * and emits an abstract `SIGN_LIVE` on the bus. It never touches the network or
 * the game — the sequence matcher and NetworkClient listen for SIGN_LIVE.
 */
export class GestureBridge {
  private readonly model = new YoloxHandSign();
  private raf = 0;
  private running = false;
  private detecting = true;
  private busy = false;
  private lastRun = 0;
  private stream: MediaStream | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly overlay: HTMLCanvasElement,
  ) {}

  get active(): boolean {
    return this.running;
  }

  get debug(): DetectDebug {
    return this.model.getDebug();
  }

  async start(): Promise<MediaStream> {
    if (this.running && this.stream) return this.stream;
    await this.model.load();
    this.stream = await startCamera(this.video);
    this.running = true;
    this.detecting = true;
    this.lastRun = 0;
    this.loop();
    return this.stream;
  }

  stop(): void {
    if (!this.running) return;
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.stream = null;
    stopCamera(this.video);
    drawDetection(this.overlay, this.video, null);
    bus.emit(Events.SIGN_LIVE, { id: null, score: 0 });
  }

  /**
   * Stop classifying seals while keeping the camera open. The 6-7 contest runs a
   * different model on this same <video>, and the WebRTC call is using the same
   * MediaStream — stopping the camera outright would black out the opponent's view.
   */
  pauseDetection(): void {
    if (!this.detecting) return;
    this.detecting = false;
    drawDetection(this.overlay, this.video, null);
    bus.emit(Events.SIGN_LIVE, { id: null, score: 0 });
  }

  resumeDetection(): void {
    if (this.detecting) return;
    this.detecting = true;
    this.lastRun = 0;
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    if (this.detecting && !this.busy && now - this.lastRun >= DETECT_INTERVAL_MS) {
      this.lastRun = now;
      this.busy = true;
      this.model
        .detect(this.video)
        .then((det) => {
          if (!this.running) return;
          drawDetection(this.overlay, this.video, det);
          bus.emit(Events.SIGN_LIVE, det ? { id: det.id, score: det.score } : { id: null, score: 0 });
        })
        .catch((err) => console.error("[GestureBridge]", err))
        .finally(() => {
          this.busy = false;
        });
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}
