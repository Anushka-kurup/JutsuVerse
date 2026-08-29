import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

const MODEL_PATH = "/models/yolox_nano.onnx";
const INPUT_SIZE = 416;
const DISPLAY_SCORE_THRESHOLD = 0.7;
const NMS_SCORE_THRESHOLD = 0.1;
const NMS_IOU_THRESHOLD = 0.45;
const STRIDES = [8, 16, 32] as const;

// The model uses zero-based classes. simple_demo.py adds one before looking up
// the corresponding row in setting/labels.csv (whose first row is "None").
const HAND_SIGN_LABELS = [
  "Ne (Rat)", "Ushi (Ox)", "Tora (Tiger)", "U (Hare)",
  "Tatsu (Dragon)", "Mi (Snake)", "Uma (Horse)", "Hitsuji (Ram)",
  "Saru (Monkey)", "Tori (Bird)", "Inu (Dog)", "I (Boar)",
  "Gassho", "Unknown", "Mizunoe",
] as const;

// Only these signs currently have an action in the game protocol.
const GAME_SIGN_BY_CLASS_ID: Record<number, string> = {
  2: "TIGER",
  5: "SNAKE",
  7: "RAM",
  9: "BIRD",
  11: "BOAR",
};

type BoundingBox = [number, number, number, number];

export interface HandSignDetection {
  bbox: BoundingBox;
  classId: number;
  label: string;
  score: number;
}

export interface FrameResult {
  detections: HandSignDetection[];
  elapsedMs: number;
  sign: string;
}

interface PreparedFrame {
  input: ort.Tensor;
  ratio: number;
  sourceHeight: number;
  sourceWidth: number;
}

let session: ort.InferenceSession | null = null;
let sessionPromise: Promise<ort.InferenceSession> | null = null;
let preprocessCanvas: HTMLCanvasElement | null = null;

// Vite's dependency optimizer cannot infer ONNX Runtime's dynamically loaded
// WASM URL in development. Importing it as an asset gives both dev and build a
// concrete URL with the correct application/wasm response type.
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, import.meta.url).href };

export async function initHandSignDetector(): Promise<void> {
  if (session) return;

  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }

  try {
    session = await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

function prepareFrame(video: HTMLVideoElement): PreparedFrame | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !sourceWidth || !sourceHeight) {
    return null;
  }

  if (!preprocessCanvas) {
    preprocessCanvas = document.createElement("canvas");
    preprocessCanvas.width = INPUT_SIZE;
    preprocessCanvas.height = INPUT_SIZE;
  }

  const context = preprocessCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not create the preprocessing canvas");

  const ratio = Math.min(INPUT_SIZE / sourceHeight, INPUT_SIZE / sourceWidth);
  const resizedWidth = Math.trunc(sourceWidth * ratio);
  const resizedHeight = Math.trunc(sourceHeight * ratio);

  // Match YoloxONNX._preprocess: resize into the top-left of a 114-filled
  // square. Canvas supplies RGB pixels, so they are reordered to OpenCV BGR.
  context.fillStyle = "rgb(114, 114, 114)";
  context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  context.drawImage(video, 0, 0, resizedWidth, resizedHeight);

  const rgba = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const planeSize = INPUT_SIZE * INPUT_SIZE;
  const chwBgr = new Float32Array(planeSize * 3);

  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const rgbaOffset = pixel * 4;
    chwBgr[pixel] = rgba[rgbaOffset + 2];
    chwBgr[planeSize + pixel] = rgba[rgbaOffset + 1];
    chwBgr[planeSize * 2 + pixel] = rgba[rgbaOffset];
  }

  return {
    input: new ort.Tensor("float32", chwBgr, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    ratio,
    sourceHeight,
    sourceWidth,
  };
}

export async function detectFrame(video: HTMLVideoElement): Promise<FrameResult> {
  if (!session) throw new Error("Hand-sign detector has not been initialized");

  const prepared = prepareFrame(video);
  if (!prepared) return { detections: [], elapsedMs: 0, sign: "UNKNOWN" };

  const startedAt = performance.now();
  const results = await session.run({ [session.inputNames[0]]: prepared.input });
  const output = results[session.outputNames[0]];
  if (!(output.data instanceof Float32Array)) {
    throw new Error(`Unexpected model output type: ${output.type}`);
  }

  const detections = decodeOutput(
    output.data,
    output.dims,
    prepared.ratio,
    prepared.sourceWidth,
    prepared.sourceHeight,
  );
  const elapsedMs = performance.now() - startedAt;
  const gameDetection = detections.find((detection) => GAME_SIGN_BY_CLASS_ID[detection.classId]);

  return {
    detections,
    elapsedMs,
    sign: gameDetection ? GAME_SIGN_BY_CLASS_ID[gameDetection.classId] : "UNKNOWN",
  };
}

function decodeOutput(
  output: Float32Array,
  dims: readonly number[],
  ratio: number,
  maxWidth: number,
  maxHeight: number,
): HandSignDetection[] {
  const rowCount = dims[dims.length - 2];
  const valuesPerRow = dims[dims.length - 1];
  const classCount = valuesPerRow - 5;
  const candidates: HandSignDetection[] = [];

  let row = 0;
  for (const stride of STRIDES) {
    const gridHeight = Math.floor(INPUT_SIZE / stride);
    const gridWidth = Math.floor(INPUT_SIZE / stride);

    for (let gridY = 0; gridY < gridHeight; gridY += 1) {
      for (let gridX = 0; gridX < gridWidth; gridX += 1) {
        if (row >= rowCount) break;
        const offset = row * valuesPerRow;
        const objectness = output[offset + 4];
        let classId = 0;
        let classProbability = output[offset + 5];

        for (let candidateClass = 1; candidateClass < classCount; candidateClass += 1) {
          const probability = output[offset + 5 + candidateClass];
          if (probability > classProbability) {
            classProbability = probability;
            classId = candidateClass;
          }
        }

        const score = objectness * classProbability;
        if (score > NMS_SCORE_THRESHOLD) {
          const centerX = (output[offset] + gridX) * stride;
          const centerY = (output[offset + 1] + gridY) * stride;
          const width = Math.exp(output[offset + 2]) * stride;
          const height = Math.exp(output[offset + 3]) * stride;
          candidates.push({
            bbox: [
              clamp((centerX - width / 2) / ratio, 0, maxWidth),
              clamp((centerY - height / 2) / ratio, 0, maxHeight),
              clamp((centerX + width / 2) / ratio, 0, maxWidth),
              clamp((centerY + height / 2) / ratio, 0, maxHeight),
            ],
            classId,
            label: HAND_SIGN_LABELS[classId] ?? `Class ${classId + 1}`,
            score,
          });
        }
        row += 1;
      }
    }
  }

  return nonMaximumSuppression(candidates, NMS_IOU_THRESHOLD)
    .filter((detection) => detection.score >= DISPLAY_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

function nonMaximumSuppression(
  detections: HandSignDetection[],
  iouThreshold: number,
): HandSignDetection[] {
  const pending = [...detections].sort((a, b) => b.score - a.score);
  const kept: HandSignDetection[] = [];

  while (pending.length > 0) {
    const best = pending.shift()!;
    kept.push(best);

    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (intersectionOverUnion(best.bbox, pending[index].bbox) > iouThreshold) {
        pending.splice(index, 1);
      }
    }
  }

  return kept;
}

function intersectionOverUnion(a: BoundingBox, b: BoundingBox): number {
  // The +1 terms match the OpenCV/Python NMS implementation in the source repo.
  const intersectionWidth = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1);
  const intersectionHeight = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const areaA = (a[2] - a[0] + 1) * (a[3] - a[1] + 1);
  const areaB = (b[2] - b[0] + 1) * (b[3] - b[1] + 1);
  return intersectionArea / (areaA + areaB - intersectionArea);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

export function drawDetections(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  detections: HandSignDetection[],
  elapsedMs: number,
): void {
  const width = video.videoWidth || 960;
  const height = video.videoHeight || 540;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.font = `${Math.max(16, Math.round(width / 50))}px "Segoe UI", sans-serif`;
  context.lineWidth = Math.max(2, width / 400);
  context.textBaseline = "bottom";

  for (const detection of detections) {
    // The video is mirrored with CSS. Mirror the boxes in canvas coordinates,
    // but leave the canvas itself unmirrored so labels remain readable.
    const [x1, y1, x2, y2] = detection.bbox;
    const displayX = width - x2;
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;
    const text = `ID:${detection.classId + 1} ${detection.label} ${detection.score.toFixed(3)}`;
    const textWidth = context.measureText(text).width;
    const textHeight = Math.max(22, width / 40);
    const textY = Math.max(textHeight, y1 - 4);

    context.strokeStyle = "#35d07f";
    context.strokeRect(displayX, y1, boxWidth, boxHeight);
    context.fillStyle = "rgba(8, 20, 15, 0.78)";
    context.fillRect(displayX, textY - textHeight, textWidth + 10, textHeight);
    context.fillStyle = "#57f29a";
    context.fillText(text, displayX + 5, textY - 2);
  }

  context.textBaseline = "top";
  const elapsedText = `Elapsed Time: ${elapsedMs.toFixed(1)}ms`;
  const elapsedWidth = context.measureText(elapsedText).width;
  context.fillStyle = "rgba(8, 20, 15, 0.78)";
  context.fillRect(8, 8, elapsedWidth + 14, Math.max(25, width / 36));
  context.fillStyle = "#57f29a";
  context.fillText(elapsedText, 15, 11);
}
