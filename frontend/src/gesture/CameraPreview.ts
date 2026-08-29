import { signById } from "../types";
import { sealTextHtml } from "../ui/sealVisual";

/**
 * Spec §4.2 layer 5 — the "what is my camera seeing" window. Lives in the DOM
 * overlay above the Phaser canvas. Shows the mirrored feed, the YOLOX detection
 * box (drawn by GestureBridge into `canvas`), the current sign as an image /
 * kanji, its confidence, and a ring that fills while a sign is being held.
 */
export class CameraPreview {
  readonly root: HTMLElement;
  readonly video: HTMLVideoElement;
  readonly canvas: HTMLCanvasElement;
  readonly remoteVideo: HTMLVideoElement;

  private readonly signBox: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly seqList: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private shownId: string | null = null;

  constructor(parent: HTMLElement, onToggle: () => void) {
    this.root = document.createElement("div");
    this.root.className = "cam-preview";
    this.root.innerHTML = `
      <div class="cam-window cam-window--local">
        <video class="cam-feed" autoplay playsinline muted></video>
        <canvas class="cam-detect" width="320" height="240"></canvas>
        <div class="cam-ring"></div>
        <span class="cam-tag">You</span>
        <span class="cam-sign">—</span>
        <span class="cam-score"></span>
      </div>
      <div class="cam-seq">
        <span class="cam-seq-label">SEALS</span>
        <span class="cam-seq-list"><span class="cam-seq-empty">—</span></span>
      </div>
      <div class="cam-window cam-window--remote">
        <video class="cam-feed" autoplay playsinline></video>
        <span class="cam-tag">Opponent</span>
      </div>
      <button class="cam-toggle" type="button">Enable camera</button>
    `;
    parent.appendChild(this.root);

    this.video = this.root.querySelector(".cam-window--local .cam-feed")!;
    this.canvas = this.root.querySelector(".cam-detect")!;
    this.remoteVideo = this.root.querySelector(".cam-window--remote .cam-feed")!;
    this.signBox = this.root.querySelector(".cam-sign")!;
    this.scoreEl = this.root.querySelector(".cam-score")!;
    this.seqList = this.root.querySelector(".cam-seq-list")!;
    this.ring = this.root.querySelector(".cam-ring")!;
    this.toggleBtn = this.root.querySelector(".cam-toggle")!;
    this.toggleBtn.addEventListener("click", onToggle);
  }

  setEnabled(on: boolean): void {
    this.root.classList.toggle("cam-preview--on", on);
    this.toggleBtn.textContent = on ? "Disable camera" : "Enable camera";
    if (!on) this.setSign(null, 0);
  }

  setBusy(label: string): void {
    this.toggleBtn.textContent = label;
  }

  /** live detection this frame */
  setSign(id: string | null, score: number): void {
    if (id === this.shownId) {
      this.scoreEl.textContent = id ? `${Math.round(score * 100)}%` : "";
      return;
    }
    this.shownId = id;
    const known = id ? Boolean(signById(id)) : false;
    this.signBox.innerHTML = known
      ? sealTextHtml(id!)
      : `<span class="seal-cell seal-cell--text seal-cell--empty"><b>—</b></span>`;
    this.signBox.classList.toggle("cam-sign--armed", known);
    this.scoreEl.textContent = known ? `${Math.round(score * 100)}%` : "";
  }

  /** the persistent committed seal sequence (keyboard-style buffer) */
  setSequence(ids: string[]): void {
    this.seqList.innerHTML = ids.length
      ? ids.map((id) => sealTextHtml(id)).join("")
      : `<span class="cam-seq-empty">—</span>`;
  }

  /** 0‥1 hold progress toward committing the current sign */
  setHoldProgress(t: number): void {
    const pct = Math.round(Math.max(0, Math.min(1, t)) * 100);
    this.ring.style.setProperty("--p", `${pct}%`);
    this.ring.classList.toggle("cam-ring--full", pct >= 100);
  }

  destroy(): void {
    this.root.remove();
  }
}
