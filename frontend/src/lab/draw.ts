import type { Hand } from "./tracker";

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// One colour per hand slot so you can see at a glance which hand the debug
// panel is calling A and which it is calling B.
export const HAND_COLORS = ["#4f7dff", "#35d0ba"];

export function clear(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

// Landmarks arrive in unmirrored coordinates; the video is displayed mirrored,
// so every x is flipped here to line the skeleton up with what you see.
export function drawHands(canvas: HTMLCanvasElement, hands: Hand[], labels: string[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  hands.forEach((hand, i) => {
    const color = HAND_COLORS[i % HAND_COLORS.length];
    const pts = hand.map((p) => ({ x: (1 - p.x) * canvas.width, y: p.y * canvas.height }));

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const label = labels[i];
    if (label) {
      ctx.fillStyle = color;
      ctx.font = "bold 16px ui-monospace, monospace";
      ctx.fillText(label, pts[0].x - 8, pts[0].y + 24);
    }
  });
}
