import Phaser from "phaser";

const ELEMENT_COLOR: Record<string, number> = {
  FIRE: 0xff7043,
  WATER: 0x35a7ff,
  EARTH: 0xc38b52,
};

const ART_SIZE = 100; // fixed size per charged image
const MAX_ARTS = 3; // seal 1 → 1 image, seal 2 → 2, seal 3+ → 3
const SPREAD = 40; // px between stacked images

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
 * The "jutsu charging up" visual in the caster's hands. Each confirmed seal adds
 * another copy of the skill art (1 → 2 → 3) rather than growing one; `release()`
 * blows it out with a shockwave and the projectile volley throws that many.
 */
export class ChargeEffect {
  readonly skillId: string;
  private readonly scene: Phaser.Scene;
  private readonly x: number;
  private readonly y: number;
  private readonly facing: 1 | -1;
  private readonly key: string;
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private readonly halo: Phaser.GameObjects.Image;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly core: Phaser.GameObjects.Image;
  private readonly arts: Phaser.GameObjects.Image[] = [];
  private readonly swirl: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly color: number;
  private readonly tweens: Phaser.Tweens.Tween[] = [];
  private readonly hasArt: boolean;
  private readonly hasGlow: boolean;
  private done = false;
  private shown = 0; // images currently on screen

  constructor(scene: Phaser.Scene, opts: ChargeOpts) {
    this.scene = scene;
    this.x = opts.x;
    this.y = opts.y;
    this.facing = opts.facing;
    this.skillId = opts.skillId;
    this.key = `jutsu-${opts.skillId}`;
    this.hasArt = scene.textures.exists(this.key);
    this.hasGlow = opts.withGlow;
    this.color = ELEMENT_COLOR[opts.element] ?? 0xffffff;

    // element glow behind the images — hidden entirely for Level 1
    const g = this.hasGlow ? 1 : 0;
    const add = (alpha: number, scale: number, depth: number) =>
      scene.add
        .image(opts.x, opts.y, "disc")
        .setTint(this.color)
        .setAlpha(alpha * g)
        .setScale(scale)
        .setDepth(depth)
        .setBlendMode(Phaser.BlendModes.ADD);

    this.halo = add(0.18, 9, 5);
    this.glow = add(0.42, 5, 6);
    this.core = add(0.9, 2.4, 7);

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
      emitting: true,
    });
    this.swirl.setDepth(6);

    this.parts.push(this.halo, this.glow, this.core, this.swirl);

    if (this.hasGlow) {
      this.tweens.push(
        scene.tweens.add({
          targets: [this.halo, this.glow, this.core],
          scale: "*=1.16",
          duration: 380,
          yoyo: true,
          repeat: -1,
          ease: "Sine.inOut",
        }),
      );
    }

    this.setProgress(1, 3);
  }

  /** size a thrown copy should launch at */
  get artSize(): number {
    return this.hasArt ? ART_SIZE : 0;
  }

  /** how many copies are charged (→ how many projectiles to throw) */
  get count(): number {
    return this.shown;
  }

  private get movers(): Phaser.GameObjects.Image[] {
    return [this.halo, this.glow, this.core, ...this.arts];
  }

  /** re-fan the images so the cluster stays centred as it grows */
  private layout(): void {
    const n = this.arts.length;
    this.arts.forEach((img, i) => {
      const off = (i - (n - 1) / 2) * SPREAD;
      img.setPosition(this.x + off, this.y - Math.abs(off) * 0.15);
      img.setAngle((i - (n - 1) / 2) * 7 * (this.facing > 0 ? 1 : -1));
      img.setDepth(8 + i);
    });
  }

  private spawnArt(): void {
    if (!this.hasArt) {
      this.shown += 1;
      return;
    }
    const img = this.scene.add
      .image(this.x, this.y, this.key)
      .setFlipX(this.facing > 0)
      .setDepth(8)
      .setDisplaySize(ART_SIZE, ART_SIZE);
    const rest = img.scaleX; // the scale that yields ART_SIZE px
    img.setAlpha(0).setScale(0);
    this.arts.push(img);
    this.parts.push(img);
    this.shown = this.arts.length;
    this.layout();
    this.scene.tweens.add({
      targets: img,
      scale: rest,
      alpha: 0.88,
      duration: 240,
      ease: "Back.out",
    });
  }

  /** `step` seals confirmed for the jutsu being formed. */
  setProgress(step: number, _total: number): void {
    if (this.done) return;
    const want = Phaser.Math.Clamp(Math.floor(step), 1, MAX_ARTS);

    while (this.shown < want) {
      this.spawnArt();
      // punch the glow (L2 only) + kick particles on each new image
      if (this.hasGlow) {
        this.scene.tweens.add({
          targets: this.core,
          scale: "*=1.4",
          duration: 130,
          yoyo: true,
          ease: "Quad.out",
        });
      }
      this.swirl.explode(22);
      this.pop(this.x, this.y, 34 + this.shown * 16, 0.5);
      this.swirl.frequency = Math.max(12, 46 - this.shown * 12);
    }
  }

  /** hand-off to the thrown projectiles: shockwave + burst, then gone */
  release(): void {
    if (this.done) return;
    this.done = true;
    this.tweens.forEach((tw) => tw.stop());
    this.swirl.stop();
    this.swirl.explode(46);
    this.pop(this.x, this.y, 150, 0.9);
    this.pop(this.x, this.y, 90, 0.7);
    this.scene.cameras.main.shake(140, 0.006);

    const burst = this.scene.add.particles(this.x, this.y, "disc", {
      tint: this.color,
      blendMode: "ADD",
      lifespan: 480,
      speed: { min: 160, max: 460 },
      scale: { start: 2.4, end: 0 },
      quantity: 40,
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
    this.tweens.forEach((tw) => tw.stop());
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

  destroy(): void {
    this.tweens.forEach((tw) => tw.stop());
    this.parts.forEach((p) => p.destroy());
    this.parts.length = 0;
    this.arts.length = 0;
    this.done = true;
  }
}
