import type { Landmarks } from "./memeTracker";

/**
 * TypeScript port of frontend/public/memes/features.py — must stay in
 * lockstep with it, since meme_forest.json (exported from
 * frontend/public/memes/export_web_model.py) was trained on exactly this
 * shape. See features.py for the full rationale; this only re-derives it.
 */
export const POSE_LANDMARK_IDS = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
} as const;

const MIN_SHOULDER_VISIBILITY = 0.5;

export const HAND_FEATURE_LEN = 42;
export const POSE_FEATURE_LEN = Object.keys(POSE_LANDMARK_IDS).length * 2; // 12
const NUM_RELATIVE_FEATURES = 2;
export const PER_FRAME_FEATURE_LEN = POSE_FEATURE_LEN + HAND_FEATURE_LEN * 2 + NUM_RELATIVE_FEATURES; // 98

export function poseIsUsable(pose: Landmarks | null): boolean {
  if (!pose) return false;
  const l = pose[POSE_LANDMARK_IDS.leftShoulder]?.visibility ?? 0;
  const r = pose[POSE_LANDMARK_IDS.rightShoulder]?.visibility ?? 0;
  return l >= MIN_SHOULDER_VISIBILITY && r >= MIN_SHOULDER_VISIBILITY;
}

function landmarksToRow(hand: Landmarks, width: number, height: number): number[] {
  const points = hand.map((lm): [number, number] => [lm.x * width, lm.y * height]);
  const [baseX, baseY] = points[0];
  const flat = points.flatMap(([x, y]): [number, number] => [x - baseX, y - baseY]);
  const maxVal = Math.max(...flat.map(Math.abs)) || 1;
  return flat.map((v) => v / maxVal);
}

function poseToRow(pose: Landmarks, width: number, height: number): number[] {
  const at = (idx: number): [number, number] => [pose[idx].x * width, pose[idx].y * height];
  const [lx, ly] = at(POSE_LANDMARK_IDS.leftShoulder);
  const [rx, ry] = at(POSE_LANDMARK_IDS.rightShoulder);
  const centerX = (lx + rx) / 2;
  const centerY = (ly + ry) / 2;
  const shoulderWidth = Math.max(Math.abs(lx - rx), 1e-6);

  const flat: number[] = [];
  for (const idx of Object.values(POSE_LANDMARK_IDS)) {
    const [x, y] = at(idx);
    flat.push((x - centerX) / shoulderWidth, (y - centerY) / shoulderWidth);
  }
  return flat;
}

export function frameToRow(
  pose: Landmarks | null,
  leftHand: Landmarks | null,
  rightHand: Landmarks | null,
  width: number,
  height: number,
): number[] {
  const usablePose = poseIsUsable(pose);
  const row: number[] = [
    ...(usablePose ? poseToRow(pose!, width, height) : new Array(POSE_FEATURE_LEN).fill(0)),
    ...(leftHand ? landmarksToRow(leftHand, width, height) : new Array(HAND_FEATURE_LEN).fill(0)),
    ...(rightHand ? landmarksToRow(rightHand, width, height) : new Array(HAND_FEATURE_LEN).fill(0)),
  ];

  if (leftHand && rightHand) {
    row.push(rightHand[0].x - leftHand[0].x, rightHand[0].y - leftHand[0].y);
  } else if (usablePose) {
    const lw = pose![POSE_LANDMARK_IDS.leftWrist];
    const rw = pose![POSE_LANDMARK_IDS.rightWrist];
    row.push(rw.x - lw.x, rw.y - lw.y);
  } else {
    row.push(0, 0);
  }
  return row;
}

export function resampleIndices(nAvailable: number, k: number): number[] {
  if (nAvailable <= 0) return [];
  if (nAvailable === 1) return new Array(k).fill(0);
  return Array.from({ length: k }, (_, i) => Math.round((i * (nAvailable - 1)) / (k - 1)));
}

export function clipToRow(frameFeatures: number[][], k: number): number[] {
  const row: number[] = [];
  for (const i of resampleIndices(frameFeatures.length, k)) row.push(...frameFeatures[i]);
  return row;
}
