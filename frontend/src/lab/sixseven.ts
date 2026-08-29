import "./lab.css";
import { initTracker, detect, delegate, startCamera, stopCamera, type Hand } from "./tracker";
import { drawHands, clear, HAND_COLORS } from "./draw";
import { palmCenter, sortForScreen } from "./geometry";
import { rawSignal, Ema } from "./signal";
import { HandPairer } from "./pairing";
import { drawTrace, type TracePoint } from "./trace";
import { Recorder, download, parse, toHands } from "./recorder";
import { ENTER, EXIT, initialState, step as countStep, reset as resetCounter } from "./counter";

// ── Steps 1-2: detection harness + signal extraction ─────────────
// Step 1  two-hand tracking, landmark overlay, dropout diagnostics.
// Step 2  collapse both hands into one normalised number and plot it.
// Thresholds and rep counting come in Steps 4-5; nothing here counts anything.

const WINDOW_MS = 3000;     // rolling window for tracking stats and the timeline
const TRACE_MS = 6000;      // the signal plot shows a longer span than the timeline
const EDGE_MARGIN = 0.04;   // a palm this close to the frame border counts as clipped
const BAD_GAP_MS = 200;     // a dropout longer than this is long enough to break a rep
const STALE_MS = 500;       // hands missing this long: forget the smoothed value

const EMA_ALPHA = 0.5;      // light smoothing; heavier lags the signal and caps rep rate

// The live Schmitt-trigger thresholds, drawn on the trace as dashed guides.
const GUIDES = { enter: ENTER, exit: EXIT };

interface Sample {
  t: number;
  hands: number;
  clipped: boolean;
}

const video = document.querySelector<HTMLVideoElement>("#video")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const overlay = document.querySelector<HTMLDivElement>("#overlay-msg")!;
const timeline = document.querySelector<HTMLCanvasElement>("#timeline")!;
const traceCanvas = document.querySelector<HTMLCanvasElement>("#trace")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop")!;
const recBtn = document.querySelector<HTMLButtonElement>("#record")!;
const loadInput = document.querySelector<HTMLInputElement>("#load")!;

let running = false;
let rafId: number | null = null;
let replayRaf: number | null = null;
let lastVideoTime = -1;
let cameraFps = 0;

let fps = 0;
let inferMs = 0;
let lastFrameAt = 0;
let samples: Sample[] = [];

const ema = new Ema(EMA_ALPHA);
const pairer = new HandPairer();
const counter = initialState();
let trace: TracePoint[] = [];
let lastValidAt = 0;
const recorder = new Recorder();

// Pop the counter on each rep — a number that only changes value reads as
// broken even when it is correct.
let flashTimer: number | null = null;
function flashRep() {
  const el = document.querySelector<HTMLElement>("#reps");
  if (!el) return;
  el.classList.remove("pop");
  void el.offsetWidth;   // restart the animation
  el.classList.add("pop");
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.remove("pop"), 220);
}

function setOverlay(text: string | null, isError = false) {
  overlay.textContent = text ?? "";
  overlay.classList.toggle("hidden", text === null);
  overlay.classList.toggle("error", isError);
}

function set(id: string, value: string, cls = "") {
  const el = document.querySelector<HTMLElement>(`#${id}`)!;
  el.textContent = value;
  el.className = cls;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function isClipped(hands: Hand[]): boolean {
  return hands.some((h) => {
    const c = palmCenter(h);
    return c.x < EDGE_MARGIN || c.x > 1 - EDGE_MARGIN || c.y < EDGE_MARGIN || c.y > 1 - EDGE_MARGIN;
  });
}

// The headline number is not "how often were both hands visible" but "how long
// were the dropouts". Brief flickers are survivable by the rep state machine;
// long gaps are not.
function analyseGaps(): { longest: number; bad: number } {
  let longest = 0;
  let bad = 0;
  let runStart = -1;

  for (let i = 0; i < samples.length; i++) {
    const lost = samples[i].hands < 2;
    if (lost && runStart < 0) runStart = i;
    if ((!lost || i === samples.length - 1) && runStart >= 0) {
      const end = lost ? samples[i].t : samples[i - 1]?.t ?? samples[runStart].t;
      const dur = end - samples[runStart].t;
      longest = Math.max(longest, dur);
      if (dur >= BAD_GAP_MS) bad++;
      runStart = -1;
    }
  }
  return { longest, bad };
}

// Paint the rolling window as a strip: green where both hands were tracked,
// amber for one, red for none. Long red bands are the thing to worry about —
// a one-frame speck is invisible to the rep counter.
function drawTimeline(now: number) {
  const ctx = timeline.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = timeline;
  ctx.clearRect(0, 0, w, h);

  const start = now - WINDOW_MS;
  const xOf = (t: number) => ((t - start) / WINDOW_MS) * w;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const x = xOf(s.t);
    const next = samples[i + 1] ? xOf(samples[i + 1].t) : w;
    ctx.fillStyle = s.hands === 2 ? "#35d0ba" : s.hands === 1 ? "#ffb454" : "#ff5470";
    ctx.fillRect(x, 0, Math.max(next - x, 1), h);
  }
}

function updatePanel(hands: Hand[], now: number, d: number, valid: boolean, scale: number) {
  set("fps", fps.toFixed(0), fps >= 24 ? "good" : fps >= 15 ? "warn" : "bad");
  set("infer", `${inferMs.toFixed(1)} ms`);
  set("delegate", delegate(), delegate() === "GPU" ? "good" : "warn");
  set("res", `${video.videoWidth}×${video.videoHeight}${cameraFps ? ` @${cameraFps}` : ""}`);
  set("count", String(hands.length), hands.length === 2 ? "good" : "warn");

  samples.push({ t: now, hands: hands.length, clipped: isClipped(hands) });
  samples = samples.filter((s) => now - s.t <= WINDOW_MS);
  const total = samples.length;

  const two = samples.filter((s) => s.hands === 2).length;
  const one = samples.filter((s) => s.hands === 1).length;
  const zero = samples.filter((s) => s.hands === 0).length;
  const clipped = samples.filter((s) => s.clipped).length;

  const stable = pct(two, total);
  set("stability", `${stable}%`, stable >= 90 ? "good" : stable >= 70 ? "warn" : "bad");
  document.querySelector<HTMLElement>("#stability-bar")!.style.width = `${stable}%`;

  set("split-2", `${pct(two, total)}%`);
  set("split-1", `${pct(one, total)}%`, one > zero && one > total * 0.1 ? "warn" : "");
  set("split-0", `${pct(zero, total)}%`, zero > total * 0.1 ? "bad" : "");
  set("clipped", `${pct(clipped, total)}%`, clipped > total * 0.1 ? "bad" : "");

  drawTimeline(now);

  const { longest, bad } = analyseGaps();
  set("gap-longest", `${Math.round(longest)} ms`, longest >= BAD_GAP_MS ? "bad" : longest >= 100 ? "warn" : "good");
  set("gap-bad", String(bad), bad > 0 ? "bad" : "good");

  // ── signal readouts: the numbers Step 4's thresholds get read off ──
  set("reps", String(counter.reps));
  set("pose", counter.pose === "A_HIGH" ? "A high" : counter.pose === "B_HIGH" ? "B high" : "between",
      counter.pose === "NEUTRAL" ? "" : "good");
  set("sig-d", valid ? d.toFixed(2) : "—");
  set("sig-scale", scale ? scale.toFixed(3) : "—");

  const bridged = trace.filter((p) => p.valid && p.held).length;
  const usable = trace.filter((p) => p.valid).length;
  const bridgePct = pct(bridged, trace.length);
  set("signal-uptime", `${pct(usable, trace.length)}%`,
      pct(usable, trace.length) >= 95 ? "good" : pct(usable, trace.length) >= 85 ? "warn" : "bad");
  set("bridged", `${bridgePct}%`, bridgePct > 40 ? "bad" : bridgePct > 20 ? "warn" : "good");

  const valids = trace.filter((p) => p.valid);
  const peakA = valids.reduce((m, p) => Math.max(m, p.d), 0);
  const peakB = valids.reduce((m, p) => Math.min(m, p.d), 0);
  set("peak-a", valids.length ? `+${peakA.toFixed(2)}` : "—");
  set("peak-b", valids.length ? peakB.toFixed(2) : "—");

  // A usable gesture swings well past the enter guide on BOTH sides; if one
  // side is short, that hand is not travelling far enough to ever be counted.
  const weakest = Math.min(peakA, -peakB);
  set("peak-min", valids.length ? weakest.toFixed(2) : "—",
      weakest >= GUIDES.enter * 1.5 ? "good" : weakest >= GUIDES.enter ? "warn" : "bad");

  set("rec-state", recorder.recording ? `recording ${(recorder.durationMs / 1000).toFixed(1)}s` : `${recorder.count} frames`,
      recorder.recording ? "bad" : "");
}

// Single path for both live camera frames and replayed ones, so a recording is
// processed by exactly the same code that produced it.
function processFrame(rawHands: Hand[], now: number) {
  const detected = sortForScreen(rawHands);

  // Slot the hands and bridge one-frame dropouts before measuring anything.
  const paired = pairer.update(detected, now);
  const pair: Hand[] = paired.complete ? [paired.a!, paired.b!] : [];
  const sig = rawSignal(pair);
  const held = paired.heldA || paired.heldB;

  if (sig.valid) {
    // a long blackout means the held average is stale and would jerk the trace
    if (now - lastValidAt > STALE_MS) ema.reset();
    lastValidAt = now;
  }

  const d = sig.valid ? ema.push(sig.raw) : ema.value;

  countStep(counter, d, sig.valid, now);
  if (counter.flippedThisFrame) flashRep();

  trace.push({ t: now, d, valid: sig.valid, held });
  trace = trace.filter((p) => now - p.t <= TRACE_MS);

  drawHands(canvas, detected, ["A", "B"]);
  updatePanel(detected, now, d, sig.valid, sig.scale);
  drawTrace(traceCanvas, trace, now, TRACE_MS, GUIDES);
  recorder.push(now, detected);
}

function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);

  // MediaPipe rejects a repeated timestamp, so only run on a fresh video frame
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  if (lastFrameAt) fps += ((1000 / (now - lastFrameAt)) - fps) * 0.1;
  lastFrameAt = now;

  const t0 = performance.now();
  const frame = detect(video, now);
  inferMs += (performance.now() - t0 - inferMs) * 0.1;

  processFrame(frame.hands, now);
}

function resetBuffers() {
  samples = [];
  trace = [];
  ema.reset();
  pairer.reset();
  resetCounter(counter);
  set("reps", "0");
  lastValidAt = 0;
}

async function start() {
  startBtn.disabled = true;
  try {
    setOverlay("Loading hand model…");
    await initTracker();
    setOverlay("Requesting camera…");
    const stream = await startCamera(video);
    cameraFps = Math.round(stream.getVideoTracks()[0]?.getSettings().frameRate ?? 0);

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    setOverlay(null);
    running = true;
    lastFrameAt = 0;
    lastVideoTime = -1;
    resetBuffers();
    stopBtn.disabled = false;
    recBtn.disabled = false;
    loop();
  } catch (err) {
    setOverlay(`Failed to start: ${(err as Error).message}`, true);
    startBtn.disabled = false;
  }
}

function stop() {
  running = false;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  stopCamera(video);
  clear(canvas);
  resetBuffers();
  setOverlay("Stopped");
  startBtn.disabled = false;
  stopBtn.disabled = true;
  if (recorder.recording) toggleRecord();
  recBtn.disabled = true;
}

function toggleRecord() {
  if (recorder.recording) {
    recorder.stop();
    recBtn.textContent = "Record";
    recBtn.classList.remove("danger");
    if (recorder.count > 0) download(recorder.build("six-seven"));
  } else {
    recorder.start();
    recBtn.textContent = "Stop & save";
    recBtn.classList.add("danger");
  }
}

// Replay drives processFrame from a file instead of the camera, paced by the
// timestamps in the recording so the trace looks exactly as it did live.
function replay(frames: ReturnType<typeof parse>["frames"]) {
  if (running) stop();
  if (replayRaf !== null) cancelAnimationFrame(replayRaf);
  resetBuffers();
  canvas.width = 640;
  canvas.height = 480;
  setOverlay(null);

  const t0 = performance.now();
  let i = 0;

  const step = () => {
    const elapsed = performance.now() - t0;
    while (i < frames.length && frames[i].t <= elapsed) {
      const f = frames[i++];
      processFrame(toHands(f), t0 + f.t);
    }
    if (i < frames.length) {
      replayRaf = requestAnimationFrame(step);
    } else {
      replayRaf = null;
      setOverlay("Replay finished");
    }
  };
  step();
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
recBtn.addEventListener("click", toggleRecord);

loadInput.addEventListener("change", async () => {
  const file = loadInput.files?.[0];
  if (!file) return;
  try {
    const rec = parse(await file.text());
    replay(rec.frames);
  } catch (err) {
    setOverlay(`Bad recording: ${(err as Error).message}`, true);
  }
  loadInput.value = "";
});

// colour the legend swatches from the same palette the overlay draws with
document.querySelectorAll<HTMLElement>(".dot.a").forEach((e) => (e.style.background = HAND_COLORS[0]));
document.querySelectorAll<HTMLElement>(".dot.b").forEach((e) => (e.style.background = HAND_COLORS[1]));
