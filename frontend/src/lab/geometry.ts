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

// Wrist -> middle-finger MCP distance. Used as the scale unit so that thresholds
// stay valid whether the player sits close to the camera or far from it.
export function handSpan(hand: Hand): number {
  const dx = hand[MCP.middle].x - hand[WRIST].x;
  const dy = hand[MCP.middle].y - hand[WRIST].y;
  return Math.hypot(dx, dy);
}
