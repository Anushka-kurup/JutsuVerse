import Phaser from "phaser";

export type CharState = "IDLE" | "CAST" | "HIT" | "KO";

const ELEMENT_COLOR: Record<string, number> = {
  FIRE: 0xff7043,
  WATER: 0x35a7ff,
  WIND: 0x74e39b,
};
const DEFENSE_COLOR = { REFLECT: 0xb16bff, PROTECT: 0x35d0ba } as const;

const BODY_HEIGHT = 300; // on-screen height of the fighter sprite
const HEAD_FROM_TOP = 0.12; // head centre, as a fraction of sprite height from the top
const FACE_FRAC = 0.19; // webcam face-circle diameter, as a fraction of sprite height

let faceKeySeq = 0;

/**
 * Spec §4.2 layer 2. A fighter: a full-body character sprite with the player's
 * live webcam face pasted (circular-cropped) over its head. Takes local gesture
 * beats (cast/pulseDefense) and synced opponent state (hit/setDefense/ko) —
 * StateSync drives it; Character just animates.
 */
export class Character {
  readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly aura: Phaser.GameObjects.Arc;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly face?: Phaser.GameObjects.Image;
  private readonly faceCanvas?: HTMLCanvasElement;
  private readonly faceTex?: Phaser.Textures.CanvasTexture;
  private idleTween?: Phaser.Tweens.Tween;
  private state: CharState = "IDLE";
  private readonly bobTargets: Phaser.GameObjects.GameObject[];

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly facing: 1 | -1,
    bodyKey: string,
    private readonly faceVideo?: HTMLVideoElement | null,
    private readonly mirrorFace = false,
  ) {
    this.shadow = scene.add.ellipse(0, 2, BODY_HEIGHT * 0.42, BODY_HEIGHT * 0.09, 0x000000, 0.35);

    this.body = scene.add.image(0, 0, scene.textures.exists(bodyKey) ? bodyKey : "ninja").setOrigin(0.5, 1);
    const s = BODY_HEIGHT / this.body.height;
    this.body.setScale(facing * s, s);
    const dh = this.body.displayHeight;

    this.aura = scene.add.circle(0, -dh * 0.55, dh * 0.34, DEFENSE_COLOR.PROTECT, 0);
    this.aura.setStrokeStyle(3, DEFENSE_COLOR.PROTECT, 0);

    const children: Phaser.GameObjects.GameObject[] = [this.shadow, this.aura, this.body];
    this.bobTargets = [this.body];

    if (faceVideo) {
      const dia = dh * FACE_FRAC;
      this.faceCanvas = document.createElement("canvas");
      this.faceCanvas.width = 160;
      this.faceCanvas.height = 160;
      const key = `face-${faceKeySeq++}`;
      this.faceTex = scene.textures.createCanvas(key, 160, 160) ?? undefined;
      this.face = scene.add
        .image(0, -dh * (1 - HEAD_FROM_TOP), key)
        .setDisplaySize(dia, dia);
      children.push(this.face);
      this.bobTargets.push(this.face);
    }

    this.root = scene.add.container(x, y, children);
    this.playIdle();
  }

  /** call once per frame from the scene — refreshes the webcam face */
  tick(): void {
    const v = this.faceVideo;
    if (!v || !this.faceCanvas || !this.faceTex || v.readyState < 2 || !v.videoWidth) return;
    const ctx = this.faceCanvas.getContext("2d")!;
    const S = this.faceCanvas.width;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    // crop a square around the upper-middle of the frame (a seated player's face)
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const crop = Math.min(vw, vh) * 0.82;
    const sx = (vw - crop) / 2;
    const sy = vh * 0.06;
    if (this.mirrorFace) {
      ctx.translate(S, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, sx, sy, crop, crop, 0, 0, S, S);
    ctx.restore();
    this.faceTex.refresh();
  }

  // ── animations ────────────────────────────────────────────────────
  private playIdle(): void {
    this.state = "IDLE";
    this.idleTween?.stop();
    this.body.setAngle(0).setAlpha(1);
    this.face?.setAngle(0).setAlpha(1);
    this.idleTween = this.scene.tweens.add({
      targets: this.bobTargets,
      y: `-=6`,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });
  }

  cast(element: string): void {
    if (this.state === "KO") return;
    this.state = "CAST";
    this.flash(ELEMENT_COLOR[element] ?? 0xffffff);
    this.scene.tweens.add({
      targets: this.root,
      x: this.root.x + this.facing * 26,
      duration: 90,
      yoyo: true,
      ease: "Quad.out",
      onComplete: () => {
        if (this.state === "CAST") this.playIdle();
      },
    });
  }

  hit(amount: number): void {
    if (this.state === "KO") return;
    this.state = "HIT";
    this.body.setTint(0xff5470);
    this.scene.tweens.add({
      targets: this.root,
      x: this.root.x - this.facing * Math.min(28, 10 + amount),
      duration: 70,
      yoyo: true,
      ease: "Quad.out",
      onComplete: () => {
        this.body.clearTint();
        if (this.state === "HIT") this.playIdle();
      },
    });
    this.scene.cameras.main.shake(120, 0.004);
  }

  setDefense(kind: "REFLECT" | "PROTECT" | null): void {
    if (!kind) {
      this.aura.setStrokeStyle(3, DEFENSE_COLOR.PROTECT, 0);
      this.aura.setFillStyle(DEFENSE_COLOR.PROTECT, 0);
      return;
    }
    const color = DEFENSE_COLOR[kind];
    this.aura.setStrokeStyle(3, color, 0.9);
    this.aura.setFillStyle(color, 0.08);
  }

  pulseDefense(kind: "REFLECT" | "PROTECT"): void {
    const color = DEFENSE_COLOR[kind];
    const ring = this.scene.add.circle(this.root.x, this.root.y - 90, 46, color, 0);
    ring.setStrokeStyle(4, color, 0.9);
    this.scene.tweens.add({
      targets: ring,
      radius: 110,
      alpha: 0,
      duration: 380,
      ease: "Quad.out",
      onComplete: () => ring.destroy(),
    });
  }

  ko(): void {
    this.state = "KO";
    this.idleTween?.stop();
    this.setDefense(null);
    this.scene.tweens.add({
      targets: [this.body, this.face].filter(Boolean),
      angle: this.facing * 82,
      alpha: 0.55,
      duration: 300,
      ease: "Quad.in",
    });
  }

  revive(): void {
    this.scene.tweens.killTweensOf([this.body, this.face].filter(Boolean));
    this.body.clearTint();
    this.root.setScale(1);
    this.playIdle();
  }

  private flash(color: number): void {
    const burst = this.scene.add.circle(this.root.x + this.facing * 30, this.root.y - 110, 12, color, 0.9);
    this.scene.tweens.add({
      targets: burst,
      radius: 56,
      alpha: 0,
      duration: 260,
      ease: "Quad.out",
      onComplete: () => burst.destroy(),
    });
  }

  destroy(): void {
    this.idleTween?.stop();
    this.root.destroy(true);
    if (this.faceTex) this.scene.textures.remove(this.faceTex.key);
  }
}
