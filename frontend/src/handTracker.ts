import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

// ── ported 1:1 from backend/player_client.py classify_sign() ───────
// Landmark indices follow MediaPipe's hand model: 8/6 = index tip/pip,
// 12/10 = middle, 16/14 = ring, 20/18 = pinky. Lower y = finger up.
export function classifySign(lm: NormalizedLandmark[]): string {
  const up = (tip: number, pip: number) => lm[tip].y < lm[pip].y;
  const idx = up(8, 6);
  const mid = up(12, 10);
  const rng = up(16, 14);
  const pnk = up(20, 18);

  if (idx && mid && !rng && !pnk) return "SNAKE";
  if (idx && !mid && !rng && pnk) return "RAM";
  if (!idx && mid && rng && !pnk) return "BOAR";
  if (idx && mid && rng && pnk) return "BIRD";
  if (!idx && !mid && !rng && !pnk) return "MONKEY";
  if (idx && !mid && !rng && !pnk) return "HORSE";
  if (!idx && !mid && rng && pnk) return "DOG";
  if (idx && mid && !rng && pnk) return "OX";
  if (!idx && mid && !rng && !pnk) return "TIGER";
  if (!idx && !mid && !rng && pnk) return "HARE";
  return "UNKNOWN";
}

let landmarker: HandLandmarker | null = null;

// One-time load of the MediaPipe WASM runtime + hand-landmark model.
// Both are fetched from Google's CDN, same as the official web examples.
export async function initHandLandmarker(): Promise<void> {
  if (landmarker) return;
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
  });
}

export interface FrameResult {
  sign: string;
  landmarks: NormalizedLandmark[] | null;
}

// Run one detection pass on the current video frame.
export function detectFrame(video: HTMLVideoElement, nowMs: number): FrameResult {
  if (!landmarker || video.readyState < 2) return { sign: "UNKNOWN", landmarks: null };
  const result = landmarker.detectForVideo(video, nowMs);
  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    return { sign: classifySign(lm), landmarks: lm };
  }
  return { sign: "UNKNOWN", landmarks: null };
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

// Draws the 21 hand landmarks + connections onto a canvas overlay,
// mirrored to match the (also mirrored) video feed.
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function drawLandmarks(canvas: HTMLCanvasElement, landmarks: NormalizedLandmark[] | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;

  const pts = landmarks.map((p) => ({ x: (1 - p.x) * canvas.width, y: p.y * canvas.height }));

  ctx.strokeStyle = "#4f7dff";
  ctx.lineWidth = 2;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
    ctx.stroke();
  }

  ctx.fillStyle = "#35d0ba";
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}