// "/wasm" subpath: CPU-only build, skips bundling the much larger
// webgl/webgpu/jsep variants we don't use
import * as ort from "onnxruntime-web/wasm";

// wasm binaries are large and version-pinned to the ort package -- load them
// from the same CDN pattern already used for the (former) mediapipe model,
// instead of wiring up local asset copying through the bundler.
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/";

const MODEL_URL = "/models/yolox_nano.onnx";
const INPUT_SIZE = 416;
const STRIDES = [8, 16, 32];
const SCORE_THRESHOLD = 0.35;

// ────────────────────────────────────────────────────────────────────
// !! PLACEHOLDER !! The model (frontend/public/models/yolox_nano.onnx) is a
// custom-trained 16-class YOLOX-Nano detector, but no labels file shipped
// with it -- these names are NOT the real classes, just positional stand-ins.
// Replace with the actual class list, in the exact order used at training
// time (e.g. from the data.yaml / classes.txt used to train the model),
// or detected signs will show the wrong names.
// ────────────────────────────────────────────────────────────────────
export const CLASS_NAMES: string[] = Array.from({ length: 16 }, (_, i) => `class_${i}`);

let session: ort.InferenceSession | null = null;
let warnedClassCountMismatch = false;

export async function initSignDetector(): Promise<void> {
  if (session) return;
  session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
}

export interface DetectionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameResult {
  sign: string;
  box: DetectionBox | null;
  score: number;
}

let letterboxCanvas: HTMLCanvasElement | null = null;

// resize+pad `video` into an INPUT_SIZE square, top-left anchored with
// gray (114) padding -- mirrors YOLOX's own preproc()
function letterbox(video: HTMLVideoElement): { canvas: HTMLCanvasElement; ratio: number } {
  if (!letterboxCanvas) {
    letterboxCanvas = document.createElement("canvas");
    letterboxCanvas.width = INPUT_SIZE;
    letterboxCanvas.height = INPUT_SIZE;
  }
  const canvas = letterboxCanvas;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ratio = Math.min(INPUT_SIZE / vw, INPUT_SIZE / vh);
  const rw = Math.round(vw * ratio);
  const rh = Math.round(vh * ratio);
  ctx.drawImage(video, 0, 0, vw, vh, 0, 0, rw, rh);
  return { canvas, ratio };
}

function toCHWTensor(canvas: HTMLCanvasElement): ort.Tensor {
  const { width, height } = canvas;
  const ctx = canvas.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, width, height); // RGBA, 0-255

  const plane = width * height;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // YOLOX's reference pipeline loads images via OpenCV (BGR) and does not
    // swap channels before training -- assumed here too; flip if detection
    // quality looks off and the training pipeline actually used RGB.
    chw[i] = b;
    chw[plane + i] = g;
    chw[plane * 2 + i] = r;
  }
  return new ort.Tensor("float32", chw, [1, 3, height, width]);
}

// mirrors YOLOX's demo_postprocess(): the exported graph leaves box coords
// as per-cell offsets/log-scales, so grid position + stride must be re-applied
function decodeBoxes(raw: Float32Array, numAnchors: number, depth: number): Float32Array {
  const out = new Float32Array(raw.length);
  out.set(raw);
  let row = 0;
  for (const stride of STRIDES) {
    const gh = INPUT_SIZE / stride;
    const gw = INPUT_SIZE / stride;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++, row++) {
        if (row >= numAnchors) return out;
        const base = row * depth;
        out[base] = (raw[base] + x) * stride;
        out[base + 1] = (raw[base + 1] + y) * stride;
        out[base + 2] = Math.exp(raw[base + 2]) * stride;
        out[base + 3] = Math.exp(raw[base + 3]) * stride;
      }
    }
  }
  return out;
}

export async function detectFrame(video: HTMLVideoElement): Promise<FrameResult> {
  if (!session || video.readyState < 2) return { sign: "UNKNOWN", box: null, score: 0 };

  const { canvas, ratio } = letterbox(video);
  const tensor = toCHWTensor(canvas);
  const results = await session.run({ images: tensor });
  const output = results[session.outputNames[0]];
  const [, numAnchors, depth] = output.dims as number[];
  const numClasses = depth - 5;

  if (numClasses !== CLASS_NAMES.length && !warnedClassCountMismatch) {
    warnedClassCountMismatch = true;
    console.warn(
      `signDetector: model outputs ${numClasses} classes but CLASS_NAMES has ${CLASS_NAMES.length} entries — update CLASS_NAMES in signDetector.ts.`
    );
  }

  const decoded = decodeBoxes(output.data as Float32Array, numAnchors, depth);

  let bestScore = 0;
  let bestClass = -1;
  let bestBase = 0;
  for (let i = 0; i < numAnchors; i++) {
    const base = i * depth;
    const objScore = decoded[base + 4];
    if (objScore < SCORE_THRESHOLD) continue;
    for (let c = 0; c < numClasses; c++) {
      const score = objScore * decoded[base + 5 + c];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
        bestBase = base;
      }
    }
  }

  if (bestClass < 0 || bestScore < SCORE_THRESHOLD) {
    return { sign: "UNKNOWN", box: null, score: 0 };
  }

  const cx = decoded[bestBase];
  const cy = decoded[bestBase + 1];
  const w = decoded[bestBase + 2];
  const h = decoded[bestBase + 3];

  // un-letterbox back to the source video's own pixel space
  const box: DetectionBox = {
    x: (cx - w / 2) / ratio,
    y: (cy - h / 2) / ratio,
    w: w / ratio,
    h: h / ratio,
  };

  const label = CLASS_NAMES[bestClass] ?? "UNKNOWN";
  return { sign: label.toUpperCase(), box, score: bestScore };
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 480, height: 360, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

// draws the detection box + label onto the overlay canvas, mirrored to
// match the (also mirrored) video feed
export function drawDetection(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  box: DetectionBox | null,
  label: string
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!box || !video.videoWidth) return;

  const sx = canvas.width / video.videoWidth;
  const sy = canvas.height / video.videoHeight;
  const bx = canvas.width - (box.x + box.w) * sx;
  const by = box.y * sy;
  const bw = box.w * sx;
  const bh = box.h * sy;

  ctx.strokeStyle = "#4f7dff";
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);

  if (label) {
    ctx.fillStyle = "#4f7dff";
    ctx.font = "14px sans-serif";
    ctx.fillText(label, bx, by > 16 ? by - 6 : by + 16);
  }
}
