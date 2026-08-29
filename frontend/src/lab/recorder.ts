import type { Hand } from "./tracker";

// Record raw landmarks to a file so a run can be replayed against changed
// thresholds. Without this, every tuning tweak means performing the gesture
// again — which is both slow and unrepeatable, since no two runs match.

export interface RecordedFrame {
  t: number;              // ms since recording started
  hands: number[][][];    // [hand][landmark][x, y, z]
}

export interface Recording {
  version: 1;
  label: string;
  fps: number;
  frames: RecordedFrame[];
}

const PRECISION = 4;   // ~1e-4 of frame width; well below landmark noise, and 3x smaller files

export class Recorder {
  private frames: RecordedFrame[] = [];
  private startedAt = 0;
  recording = false;

  start(): void {
    this.frames = [];
    this.startedAt = 0;
    this.recording = true;
  }

  push(t: number, hands: Hand[]): void {
    if (!this.recording) return;
    if (!this.startedAt) this.startedAt = t;
    this.frames.push({
      t: Math.round(t - this.startedAt),
      hands: hands.map((h) => h.map((p) => [round(p.x), round(p.y), round(p.z)])),
    });
  }

  stop(): void {
    this.recording = false;
  }

  get count(): number {
    return this.frames.length;
  }

  get durationMs(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  build(label: string): Recording {
    const dur = this.durationMs / 1000;
    return {
      version: 1,
      label,
      fps: dur > 0 ? Math.round(this.frames.length / dur) : 0,
      frames: this.frames,
    };
  }
}

function round(v: number): number {
  return Number(v.toFixed(PRECISION));
}

export function download(rec: Recording): void {
  const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${rec.label || "six-seven"}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parse(text: string): Recording {
  const rec = JSON.parse(text) as Recording;
  if (rec?.version !== 1 || !Array.isArray(rec.frames)) throw new Error("not a v1 recording");
  return rec;
}

// visibility is not stored — nothing downstream reads it, only x/y are used.
export function toHands(frame: RecordedFrame): Hand[] {
  return frame.hands.map((h) => h.map(([x, y, z]) => ({ x, y, z, visibility: 1 })));
}
