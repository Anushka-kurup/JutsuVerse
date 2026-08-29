import type { Edge, Sign } from "@jutsu/protocol";

export type SignListener = (e: { sign: Sign; edge: Edge }) => void;

export interface InputAdapter {
  start(onEdge: SignListener): void;
  stop(): void;
}
