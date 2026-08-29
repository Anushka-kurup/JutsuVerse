import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export type Landmarks = NormalizedLandmark[];

export interface MemeFrame {
  pose: Landmarks | null;
  leftHand: Landmarks | null;
  rightHand: Landmarks | null;
}

/**
 * Arms + hands tracking for the meme-gesture classifier, mirroring
 * frontend/public/memes/pose_hands.py: PoseLandmarker + HandLandmarker run
 * side by side, with no face model in the loop at all. Same WASM runtime and
 * /public-served models as lab/tracker.ts (see its own comment for why).
 */
let poseLandmarker: PoseLandmarker | null = null;
let handLandmarker: HandLandmarker | null = null;

export async function initMemeTracker(): Promise<void> {
  if (poseLandmarker && handLandmarker) return;
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");

  // Deliberately loose — matches lab/tracker.ts's own hand tracker (used for
  // the six-seven contest), which found the same thing: a high floor here
  // means MediaPipe throws away frames it was willing to track at all, and
  // that's a bigger loss than the noise a looser threshold lets through.
  const poseOptions = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/mediapipe/models/pose_landmarker_lite.task", delegate },
    runningMode: "VIDEO" as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.35,
    minPosePresenceConfidence: 0.35,
    minTrackingConfidence: 0.25,
  });
  const handOptions = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/mediapipe/models/hand_landmarker.task", delegate },
    runningMode: "VIDEO" as const,
    numHands: 2,
    minHandDetectionConfidence: 0.35,
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.25,
  });

  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(fileset, poseOptions("GPU"));
    handLandmarker = await HandLandmarker.createFromOptions(fileset, handOptions("GPU"));
  } catch {
    // some laptops / remote desktops have no usable WebGL — fall back rather than die
    poseLandmarker = await PoseLandmarker.createFromOptions(fileset, poseOptions("CPU"));
    handLandmarker = await HandLandmarker.createFromOptions(fileset, handOptions("CPU"));
  }
}

export function detectMemeFrame(video: HTMLVideoElement, tMs: number): MemeFrame {
  if (!poseLandmarker || !handLandmarker || video.readyState < 2) {
    return { pose: null, leftHand: null, rightHand: null };
  }
  const poseResult = poseLandmarker.detectForVideo(video, tMs);
  const handResult = handLandmarker.detectForVideo(video, tMs);

  let leftHand: Landmarks | null = null;
  let rightHand: Landmarks | null = null;
  handResult.landmarks.forEach((lm, i) => {
    const label = handResult.handedness[i]?.[0]?.categoryName;
    if (label === "Left") leftHand = lm;
    else if (label === "Right") rightHand = lm;
  });

  return { pose: poseResult.landmarks[0] ?? null, leftHand, rightHand };
}
