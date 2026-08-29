import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Hand = NormalizedLandmark[];

export interface HandFrame {
  hands: Hand[];   // 0, 1 or 2 hands, in MediaPipe's own order
  tMs: number;     // video timestamp the detection ran against
}

// Landmark indices we care about downstream (MediaPipe hand model).
export const WRIST = 0;
export const MCP = { index: 5, middle: 9, ring: 13, pinky: 17 } as const;

let landmarker: HandLandmarker | null = null;
let activeDelegate: "GPU" | "CPU" = "GPU";

export function delegate(): "GPU" | "CPU" {
  return activeDelegate;
}

// WASM runtime and model are served from /public, not a CDN — venue wifi
// should not be able to break the demo.
export async function initTracker(): Promise<void> {
  if (landmarker) return;
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");

  const options = (d: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/mediapipe/models/hand_landmarker.task", delegate: d },
    runningMode: "VIDEO" as const,
    numHands: 2,
    // Deliberately loose. Fast 6-7 motion blurs the hands, which tanks
    // confidence; we would rather have a slightly noisy landmark than no hand
    // at all, because the pose logic downstream smooths and gates anyway.
    minHandDetectionConfidence: 0.35,
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.25,
  });

  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, options("GPU"));
    activeDelegate = "GPU";
  } catch {
    // some laptops / remote desktops have no usable WebGL — fall back rather than die
    landmarker = await HandLandmarker.createFromOptions(fileset, options("CPU"));
    activeDelegate = "CPU";
  }
}

export function detect(video: HTMLVideoElement, tMs: number): HandFrame {
  if (!landmarker || video.readyState < 2) return { hands: [], tMs };
  const result = landmarker.detectForVideo(video, tMs);
  return { hands: result.landmarks ?? [], tMs };
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // 60fps matters more than resolution here: a higher frame rate forces a
    // shorter exposure, which is what actually cuts the motion blur that makes
    // MediaPipe lose fast-moving hands.
    video: {
      // More pixels on the hands is the single biggest lever on detection rate,
      // and inference is only using ~1/3 of the frame budget at 640x480.
      width: { ideal: 960 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 },
      facingMode: "user",
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(video: HTMLVideoElement): void {
  (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
