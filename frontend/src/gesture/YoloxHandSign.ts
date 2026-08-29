import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { HAND_SIGNS, signByIndex } from "../types";

/**
 * Module 1 — single-frame hand-sign detection.
 *
 * Detection method is a faithful port of the working reference (the teammate's
 * src/handTracker.ts), which itself mirrors `model/yolox/yolox_onnx.py` from
 * github.com/Kazuhito00/NARUTO-HandSignDetection:
 *
 *   preprocess : letterbox to 416 (top-left, pad 114), BGR, no normalisation
 *   decode     : per grid cell  score = obj × max(classProb)
 *   collect    : every cell with score > NMS_SCORE_TH (0.1)
 *   NMS        : class-agnostic, IoU 0.45, greedy, OpenCV +1 area terms
 *   accept     : survivors with score ≥ DISPLAY_SCORE_TH (0.7)  ← the precision knob
 *
 * The earlier home-grown version thresholded BEFORE NMS at 0.3 and added a
 * "runner-up margin", which let low-confidence noise through — that's what made
 * recognition feel bad.  This matches the reference exactly; tune DISPLAY_SCORE_TH.
 *
 * Class index = raw model class (0 = Rat, per shared/handSigns.ts — the repo's
 * demos do labels.csv[class_id + 1], row 0 being a dummy "None").
 */

const MODEL_URL = `${import.meta.env.BASE_URL}models/yolox_nano.onnx`;
const INPUT = 416;
const STRIDES = [8, 16, 32] as const;
const NMS_SCORE_TH = 0.1; // repo nms_score_th — collect almost everything, let NMS sort it out
/**
 * THE accuracy knob. Survivors of NMS with score ≥ this are accepted.
 * repo `--score_th` default is 0.7 (very strict); its `class_score_th` is 0.3.
 * Lower = detects more (and more noise), higher = fewer but surer. Press D
 * in battle to see the real per-sign scores and pick a value just under them.
 */
const DISPLAY_SCORE_TH = 0.4;
const NMS_IOU = 0.45;

export interface Detection {
  index: number;
  id: string;
  score: number;
  /** [x1, y1, x2, y2] in source-video pixels */
  box: [number, number, number, number];
}

export interface DetectDebug {
  dims: number[];
  numClasses: number;
  handSignsLen: number;
  /** objectness of the current best cell */
  obj: number;
  /** range of raw class values seen — [~0,~1] = probabilities, wider = logits */
  valueRange: [number, number];
  /** top classes this frame, threshold ignored */
  top: { index: number; id: string; score: number }[];
}

// Vite's dep optimizer can't infer ONNX Runtime's dynamically-loaded WASM URL in
// dev. Importing it as an asset gives dev + build a concrete URL with the right
// application/wasm response type (this is what the reference does).
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, import.meta.url).href };
ort.env.wasm.numThreads = 1; // no SharedArrayBuffer / COOP-COEP needed

export class YoloxHandSign {
  private session: ort.InferenceSession | null = null;
  private sessionPromise: Promise<ort.InferenceSession> | null = null;
  private readonly work = document.createElement("canvas");
  private readonly chw = new Float32Array(3 * INPUT * INPUT);
  private loggedShape = false;

  readonly debug: DetectDebug = {
    dims: [],
    numClasses: 0,
    handSignsLen: HAND_SIGNS.length,
    obj: 0,
    valueRange: [0, 0],
    top: [],
  };

  get ready(): boolean {
    return this.session !== null;
  }

  async load(): Promise<void> {
    if (this.session) return;
    if (!this.sessionPromise) {
      this.sessionPromise = ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    }
    try {
      this.session = await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      throw err;
    }
    this.work.width = INPUT;
    this.work.height = INPUT;
  }

  getDebug(): DetectDebug {
    return this.debug;
  }

  /** Best detection this frame, or null. */
  async detect(video: HTMLVideoElement): Promise<Detection | null> {
    if (!this.session) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !vw || !vh) return null;

    // ── preprocess: letterbox into a 114-filled 416² square, BGR, CHW, no norm ──
    const ratio = Math.min(INPUT / vh, INPUT / vw);
    const rw = Math.trunc(vw * ratio);
    const rh = Math.trunc(vh * ratio);
    const ctx = this.work.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "rgb(114, 114, 114)";
    ctx.fillRect(0, 0, INPUT, INPUT);
    ctx.drawImage(video, 0, 0, rw, rh);
    const rgba = ctx.getImageData(0, 0, INPUT, INPUT).data;

    const plane = INPUT * INPUT;
    for (let p = 0; p < plane; p++) {
      const o = p * 4;
      this.chw[p] = rgba[o + 2]; // B
      this.chw[plane + p] = rgba[o + 1]; // G
      this.chw[plane * 2 + p] = rgba[o]; // R
    }

    const out = await this.session.run({
      [this.session.inputNames[0]]: new ort.Tensor("float32", this.chw, [1, 3, INPUT, INPUT]),
    });
    const t = out[this.session.outputNames[0]];
    return this.decode(t.data as Float32Array, t.dims as number[], ratio, vw, vh);
  }

  private decode(
    raw: Float32Array,
    dims: number[],
    ratio: number,
    maxW: number,
    maxH: number,
  ): Detection | null {
    const rowCount = dims[dims.length - 2];
    const valuesPerRow = dims[dims.length - 1];
    const classCount = valuesPerRow - 5;

    this.debug.dims = dims.slice();
    this.debug.numClasses = classCount;
    if (!this.loggedShape) {
      this.loggedShape = true;
      console.info(
        `[YOLOX] out ${dims.join("x")} · ${classCount} classes · HAND_SIGNS ${HAND_SIGNS.length}`,
      );
    }

    const candidates: Detection[] = [];
    const scoreByClass = new Float64Array(Math.max(0, classCount));
    let bestScore = 0;
    let bestObj = 0;
    let vMin = Infinity;
    let vMax = -Infinity;

    let row = 0;
    for (const stride of STRIDES) {
      const grid = Math.floor(INPUT / stride);
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          if (row >= rowCount) break;
          const o = row * valuesPerRow;
          row++;

          const obj = raw[o + 4];
          let classId = 0;
          let classProb = raw[o + 5];
          if (classProb < vMin) vMin = classProb;
          if (classProb > vMax) vMax = classProb;
          for (let c = 1; c < classCount; c++) {
            const p = raw[o + 5 + c];
            if (p < vMin) vMin = p;
            if (p > vMax) vMax = p;
            if (p > classProb) {
              classProb = p;
              classId = c;
            }
          }

          const score = obj * classProb;
          scoreByClass[classId] = Math.max(scoreByClass[classId], score);
          if (score > bestScore) {
            bestScore = score;
            bestObj = obj;
          }
          if (score <= NMS_SCORE_TH) continue;
          const sign = signByIndex(classId);
          if (!sign) continue; // raw model classes 14 and 15 are not game signs

          const cx = (raw[o] + gx) * stride;
          const cy = (raw[o + 1] + gy) * stride;
          const w = Math.exp(raw[o + 2]) * stride;
          const h = Math.exp(raw[o + 3]) * stride;
          candidates.push({
            index: classId,
            id: sign.id,
            score,
            box: [
              clamp((cx - w / 2) / ratio, 0, maxW),
              clamp((cy - h / 2) / ratio, 0, maxH),
              clamp((cx + w / 2) / ratio, 0, maxW),
              clamp((cy + h / 2) / ratio, 0, maxH),
            ],
          });
        }
      }
    }

    this.debug.obj = bestObj;
    this.debug.valueRange = [Number.isFinite(vMin) ? vMin : 0, Number.isFinite(vMax) ? vMax : 0];
    this.debug.top = Array.from(scoreByClass, (score, index) => ({
      index,
      id: signByIndex(index)?.id ?? "",
      score,
    }))
      .filter((e) => e.id !== "" && e.score > 0.01)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const kept = nms(candidates, NMS_IOU)
      .filter((d) => d.score >= DISPLAY_SCORE_TH)
      .sort((a, b) => b.score - a.score);
    return kept[0] ?? null;
  }
}

// greedy class-agnostic NMS, OpenCV-style +1 area terms (matches the repo's _nms)
function nms(dets: Detection[], iouTh: number): Detection[] {
  const pending = [...dets].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  while (pending.length) {
    const best = pending.shift()!;
    kept.push(best);
    for (let i = pending.length - 1; i >= 0; i--) {
      if (iou(best.box, pending[i].box) > iouTh) pending.splice(i, 1);
    }
  }
  return kept;
}

function iou(a: number[], b: number[]): number {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1);
  const ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1);
  const inter = iw * ih;
  const areaA = (a[2] - a[0] + 1) * (a[3] - a[1] + 1);
  const areaB = (b[2] - b[0] + 1) * (b[3] - b[1] + 1);
  return inter / (areaA + areaB - inter || 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Draw the detection box + label onto the preview overlay canvas (mirrored to match the feed). */
export function drawDetection(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  det: Detection | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!det || !video.videoWidth) return;

  const sx = canvas.width / video.videoWidth;
  const sy = canvas.height / video.videoHeight;
  const [x1, y1, x2, y2] = det.box;
  const mx = canvas.width - x2 * sx; // feed is CSS-mirrored
  ctx.strokeStyle = "#35d07f";
  ctx.lineWidth = 2;
  ctx.strokeRect(mx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy);
  ctx.fillStyle = "#57f29a";
  ctx.font = "bold 14px monospace";
  ctx.fillText(`${det.id} ${(det.score * 100) | 0}%`, mx + 2, Math.max(12, y1 * sy - 4));
}
