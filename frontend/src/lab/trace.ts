// Scrolling plot of the 6-7 signal. This is the instrument the thresholds get
// read off in Step 4 — guess the numbers from a live webcam and you will be
// wrong; read them off a trace of your own hands and you will not.

export interface TracePoint {
  t: number;
  d: number;
  valid: boolean;   // both hands available (measured or bridged)
  held: boolean;    // at least one hand was bridged from its last known position
}

export interface Guides {
  enter: number;
  exit: number;
}

const AXIS = "#3a4354";
const LINE = "#4f7dff";
const HELD = "#38508f";   // dimmed: real reading, bridged hand
const GAP = "#ff5470";

export function drawTrace(
  canvas: HTMLCanvasElement,
  points: TracePoint[],
  now: number,
  windowMs: number,
  guides: Guides,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);

  // Auto-scale to the data, with a floor so an idle trace does not look frantic.
  const peak = points.reduce((m, p) => (p.valid ? Math.max(m, Math.abs(p.d)) : m), 0);
  const yMax = Math.max(1.5, peak * 1.15);

  const start = now - windowMs;
  const xOf = (t: number) => ((t - start) / windowMs) * w;
  const yOf = (d: number) => h / 2 - (d / yMax) * (h / 2);

  // candidate thresholds — the bands a flip has to cross to be counted
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  for (const [v, color] of [[guides.enter, "#35d0ba"], [guides.exit, "#ffb454"]] as const) {
    ctx.strokeStyle = color;
    for (const sign of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(0, yOf(sign * v));
      ctx.lineTo(w, yOf(sign * v));
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // zero line
  ctx.strokeStyle = AXIS;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // The signal, segment by segment so bridged stretches can be dimmed. It only
  // breaks where a hand was missing for longer than the bridge holds.
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (!prev.valid || !cur.valid) continue;
    ctx.strokeStyle = cur.held || prev.held ? HELD : LINE;
    ctx.beginPath();
    ctx.moveTo(xOf(prev.t), yOf(prev.d));
    ctx.lineTo(xOf(cur.t), yOf(cur.d));
    ctx.stroke();
  }

  // mark dropouts along the bottom so gaps stay visible on the plot too
  ctx.fillStyle = GAP;
  for (const p of points) {
    if (!p.valid) ctx.fillRect(xOf(p.t), h - 3, 2, 3);
  }

  // axis labels in hand spans
  ctx.fillStyle = AXIS;
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(`+${yMax.toFixed(1)}`, 4, 11);
  ctx.fillText(`-${yMax.toFixed(1)}`, 4, h - 4);
  ctx.fillText("A higher", w - 58, 11);
  ctx.fillText("B higher", w - 58, h - 4);
}
