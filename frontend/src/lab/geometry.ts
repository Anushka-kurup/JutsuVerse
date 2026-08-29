import type { Hand } from "./tracker";
import { WRIST, MCP } from "./tracker";

export interface Point { x: number; y: number; }

// Palm centre is much steadier frame-to-frame than the wrist landmark alone,
// which wobbles as the fingers move.
export function palmCenter(hand: Hand): Point {
  const ids = [WRIST, MCP.index, MCP.middle, MCP.ring, MCP.pinky];
  let x = 0, y = 0;
  for (const i of ids) { x += hand[i].x; y += hand[i].y; }
  return { x: x / ids.length, y: y / ids.length };
}

// Sort hands left-to-right *as seen on screen*. The video is mirrored, so screen
// x is (1 - landmark x). MediaPipe's own hand order is not stable between frames,
// and its handedness labels are unreliable on a mirrored feed — position is.
export function sortForScreen(hands: Hand[]): Hand[] {
  return [...hands].sort((h1, h2) => palmCenter(h2).x - palmCenter(h1).x);
}

// Wrist -> middle-finger MCP distance. Used as the scale unit so that thresholds
// stay valid whether the player sits close to the camera or far from it.
export function handSpan(hand: Hand): number {
  const dx = hand[MCP.middle].x - hand[WRIST].x;
  const dy = hand[MCP.middle].y - hand[WRIST].y;
  return Math.hypot(dx, dy);
}
