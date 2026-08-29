import type { Sign } from "@jutsu/protocol";

export type WebRtcSignal =
  | { kind: "webrtc-offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "webrtc-answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "webrtc-ice"; candidate: RTCIceCandidateInit };

export function isWebRtcSignal(value: unknown): value is WebRtcSignal {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind: unknown }).kind;
  return kind === "webrtc-offer" || kind === "webrtc-answer" || kind === "webrtc-ice";
}

export interface SignDef {
  sign: Sign;
  label: string;
  kind: "ATTACK" | "REFLECT" | "PROTECT";
}

export const SIGNS: SignDef[] = [
  { sign: "TIGER", label: "Tiger seal", kind: "ATTACK" },
  { sign: "SNAKE", label: "Snake seal", kind: "ATTACK" },
  { sign: "BIRD", label: "Bird seal", kind: "ATTACK" },
  { sign: "RAM", label: "Ram seal", kind: "REFLECT" },
  { sign: "BOAR", label: "Boar seal", kind: "PROTECT" },
  { sign: "OX", label: "Ox seal", kind: "ATTACK" },
];
