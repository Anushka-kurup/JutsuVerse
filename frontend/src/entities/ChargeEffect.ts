import Phaser from "phaser";

const ELEMENT_COLOR: Record<string, number> = {
  FIRE: 0xff7043,
  WATER: 0x35a7ff,
  EARTH: 0xc38b52,
};

const ART_SIZE = 100; // base size per charged image (before the size multiplier)
const SPREAD = 42; // px between stacked images, scaled by the size multiplier
const GLOW_ALPHA = { halo: 0.18, glow: 0.42, core: 0.9 };

export interface ChargeOpts {
  x: number;
  y: number;
  element: string;
  skillId: string;
  facing: 1 | -1;
  /** the element glow behind the images — only Level 2 gets it */
  withGlow: boolean;
}

/**
 * The "jutsu charging up" visual in the caster's hands. It escalates by seal:
 *   seal 1 → 1 image · seal 2 → 1 image, bigger · seal 3 → 2 images ·
 *   seal 4 (Level 2) → 3 images, bigger still, + the element glow behind.
 * `release()` blows it out; the volley throws `count` copies at `artSize`.
 */
export class ChargeEffect {
  readonly element: string;
  private readonly scene: Phaser.Scene;
  private readonly x: number;
  private readonly y: number;
  private readonly facing: 1 | -1;
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private readonly halo: Phaser.GameObjects.Image;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly core: Phaser.GameObjects.Image;
  private readonly arts: Phaser.GameObjects.Image[] = [];
  private readonly swirl: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly color: number;
  private readonly tweens: Phaser.Tweens.Tween[] = [];
  private key: string;
  private skillId: string;
  private hasGlow = false;
  private pulse?: Phaser.Tweens.Tween;
  private sizeMul = 1;
  private shown = 0;
  private done = false;

  constructor(scene: Phaser.Scene, opts: ChargeOpts) {
    this.scene = scene;
    this.x = opts.x;
    this.y = opts.y;
    this.facing = opts.facing;
    this.element = opts.element;
    this.skillId = opts.skillId;
    this.key = `jutsu-${opts.skillId}`;
    this.color = ELEMENT_COLOR[opts.element] ?? 0xffffff;

    const add = (depth: number) =>
      scene.add
        .image(opts.x, opts.y, "disc")
        .setTint(this.color)
        .setAlpha(0) // element glow starts hidden — only Level 2 lights it
        .setDepth(depth)
        .setBlendMode(Phaser.BlendModes.ADD);
    this.halo = add(5).setScale(9);
    this.glow = add(6).setScale(5);
    this.core = add(7).setScale(2.4);

    // the rotating particle glow — Level 2 only (started by enableGlow)
    this.swirl = scene.add.particles(opts.x, opts.y, "disc", {
      tint: this.color,
      blendMode: "ADD",
      lifespan: 520,
      speed: { min: 50, max: 210 },
      angle: { min: 0, max: 360 },
      scale: { start: 2, end: 0 },
      rotate: { min: 0, max: 360 },
      quantity: 2,
      frequency: 40,
      emitting: false,
    });
    this.swirl.setDepth(6);

    this.parts.push(this.halo, this.glow, this.core, this.swirl);
    if (opts.withGlow) this.enableGlow();

    this.setProgress(1, 3);
  }

  /** size a thrown copy should launch at (matches the current charged size) */
  get artSize(): number {
    return this.scene.textures.exists(this.key) ? ART_SIZE * this.sizeMul : 0;
  }

  /** how many copies are charged → how many projectiles to throw */
  get count(): number {
    return this.shown;
  }

  private get movers(): Phaser.GameObjects.Image[] {
    return [this.halo, this.glow, this.core, ...this.arts];
  }

  /** the L1 sequence extended to its L2 form — swap art + light the glow */
  retarget(skillId: string, withGlow: boolean): void {
    if (this.done) return;
    if (skillId !== this.skillId) {
      this.skillId = skillId;
      const next = `jutsu-${skillId}`;
      if (this.scene.textures.exists(next)) {
        this.key = next;
        for (const img of this.arts) {
          img.setTexture(next).setFlipX(this.facing > 0).setScale(this.restScale(img));
        }
      }
    }
    if (withGlow && !this.hasGlow) this.enableGlow();
  }

  /** `step` seals confirmed for the jutsu being formed. */
  setProgress(step: number, _total: number): void {
    if (this.done) return;
    const images = step <= 2 ? 1 : step === 3 ? 2 : 3;
    const mul = step <= 1 ? 1 : step <= 3 ? 1.28 : 1.7;

    if (mul !== this.sizeMul) {
      this.sizeMul = mul;
      this.layout();
      for (const img of this.arts) {
        this.scene.tweens.add({
          targets: img,
          scale: this.restScale(img),
          duration: 200,
          ease: "Back.out",
        });
      }
      this.pop(this.x, this.y, 44 + this.sizeMul * 20, 0.5);
    }

    while (this.shown < images) {
      this.spawnArt();
      this.pop(this.x, this.y, 34 + this.shown * 16, 0.5);
      if (this.hasGlow) {
        this.swirl.explode(22);
        this.swirl.frequency = Math.max(12, 46 - this.shown * 12);
        this.scene.tweens.add({
          targets: this.core,
          scale: "*=1.4",
          duration: 130,
          yoyo: true,
          ease: "Quad.out",
        });
      }
    }
  }

  /** hand-off to the thrown projectiles: shockwave + burst, then gone */
  release(): void {
    if (this.done) return;
    this.done = true;
    this.stopTweens();
    if (this.hasGlow) this.swirl.explode(46);
    this.swirl.stop();
    this.pop(this.x, this.y, 150, 0.9);
    this.pop(this.x, this.y, 90, 0.7);
    this.scene.cameras.main.shake(140, 0.006);

    const burst = this.scene.add.particles(this.x, this.y, "disc", {
      tint: this.color,
      blendMode: "ADD",
      lifespan: 480,
      speed: { min: 160, max: 460 },
      scale: { start: 2.4, end: 0 },
      emitting: false,
    });
    burst.setDepth(7);
    burst.explode(40, this.x, this.y);
    this.scene.time.delayedCall(560, () => burst.destroy());

    this.scene.tweens.add({
      targets: this.movers,
      scale: "*=2.2",
      alpha: 0,
      duration: 190,
      ease: "Quad.out",
      onComplete: () => this.destroy(),
    });
  }

  /** sequence abandoned — shrink away */
  dismiss(): void {
    if (this.done) return;
    this.done = true;
    this.stopTweens();
    this.swirl.stop();
    this.scene.tweens.add({
      targets: this.movers,
      scale: 0,
      alpha: 0,
      duration: 220,
      ease: "Quad.in",
      onComplete: () => this.destroy(),
    });
  }

  destroy(): void {
    this.stopTweens();
    this.parts.forEach((p) => p.destroy());
    this.parts.length = 0;
    this.arts.length = 0;
    this.done = true;
  }

  // ── internals ───────────────────────────────────────────────────────

  /** scale that renders `img` at ART_SIZE × the current multiplier */
  private restScale(img: Phaser.GameObjects.Image): number {
    return (ART_SIZE * this.sizeMul) / img.width;
  }

  private spawnArt(): void {
    if (!this.scene.textures.exists(this.key)) {
      this.shown += 1;
      return;
    }
    const img = this.scene.add
      .image(this.x, this.y, this.key)
      .setFlipX(this.facing > 0)
      .setDepth(8)
      .setAlpha(0)
      .setScale(0);
    this.arts.push(img);
    this.parts.push(img);
    this.shown = this.arts.length;
    this.layout();
    this.scene.tweens.add({
      targets: img,
      scale: this.restScale(img),
      alpha: 0.88,
      duration: 240,
      ease: "Back.out",
    });
  }

  /** re-fan the images so the cluster stays centred as it grows */
  private layout(): void {
    const n = this.arts.length;
    const gap = SPREAD * this.sizeMul;
    this.arts.forEach((img, i) => {
      const off = (i - (n - 1) / 2) * gap;
      img.setPosition(this.x + off, this.y - Math.abs(off) * 0.15);
      img.setAngle((i - (n - 1) / 2) * 7 * (this.facing > 0 ? 1 : -1));
      img.setDepth(8 + i);
    });
  }

  private enableGlow(): void {
    if (this.hasGlow) return;
    this.hasGlow = true;
    this.swirl.frequency = 40;
    this.swirl.start();
    this.tweens.push(
      this.scene.tweens.add({ targets: this.halo, alpha: GLOW_ALPHA.halo, duration: 220 }),
      this.scene.tweens.add({ targets: this.glow, alpha: GLOW_ALPHA.glow, duration: 220 }),
      this.scene.tweens.add({ targets: this.core, alpha: GLOW_ALPHA.core, duration: 220 }),
    );
    this.pulse = this.scene.tweens.add({
      targets: [this.halo, this.glow, this.core],
      scale: "*=1.16",
      duration: 380,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });
    this.pop(this.x, this.y, 120, 0.8);
  }

  /** an expanding stroked ring — the "shockwave" */
  private pop(x: number, y: number, radius: number, alpha: number): void {
    const ring = this.scene.add
      .circle(x, y, 8, this.color, 0)
      .setStrokeStyle(3, this.color, alpha)
      .setDepth(6)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: 320,
      ease: "Quad.out",
      onComplete: () => ring.destroy(),
    });
  }

  private stopTweens(): void {
    this.pulse?.stop();
    this.tweens.forEach((tw) => tw.stop());
  }
}
