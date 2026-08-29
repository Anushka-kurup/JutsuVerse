import Phaser from "phaser";

const ELEMENT_COLOR: Record<string, number> = {
  FIRE: 0xff7043,
  WATER: 0x35a7ff,
  EARTH: 0xc38b52,
};

export interface ChargeOpts {
  x: number;
  y: number;
  element: string;
  skillId: string;
  facing: 1 | -1;
}

/**
 * The "jutsu charging up" visual that grows in the caster's hands while the seal
 * sequence is being formed. One seal in → a faint element orb + skill art; each
 * further seal punches it bigger and brighter. `release()` flares it out (the
 * projectile volley takes over from the same spot); `dismiss()` fades it if the
 * sequence is abandoned.
 */
export class ChargeEffect {
  readonly skillId: string;
  private readonly scene: Phaser.Scene;
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private readonly glow: Phaser.GameObjects.Image;
  private readonly core: Phaser.GameObjects.Image;
  private readonly art: Phaser.GameObjects.Image | null;
  private readonly ring: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly movers: Phaser.GameObjects.Image[];
  private readonly color: number;
  private pulse?: Phaser.Tweens.Tween;
  private done = false;
  private t = 0; // 0‥1 charge level

  constructor(scene: Phaser.Scene, opts: ChargeOpts) {
    this.scene = scene;
    this.skillId = opts.skillId;
    this.color = ELEMENT_COLOR[opts.element] ?? 0xffffff;

    this.glow = scene.add
      .image(opts.x, opts.y, "disc")
      .setTint(this.color)
      .setAlpha(0.22)
      .setScale(4)
      .setDepth(6)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.core = scene.add
      .image(opts.x, opts.y, "disc")
      .setTint(this.color)
      .setAlpha(0.9)
      .setScale(1.6)
      .setDepth(7)
      .setBlendMode(Phaser.BlendModes.ADD);

    const key = `jutsu-${opts.skillId}`;
    this.art = scene.textures.exists(key)
      ? scene.add
          .image(opts.x, opts.y, key)
          .setFlipX(opts.facing > 0)
          .setDepth(8)
          .setAlpha(0)
          .setDisplaySize(60, 60)
      : null;

    this.ring = scene.add.particles(opts.x, opts.y, "disc", {
      tint: this.color,
      blendMode: "ADD",
      lifespan: 460,
      speed: { min: 18, max: 46 },
      scale: { start: 1.4, end: 0 },
      quantity: 0,
      frequency: 90,
      emitting: true,
    });
    this.ring.setDepth(6);

    this.movers = this.art ? [this.glow, this.core, this.art] : [this.glow, this.core];
    this.parts.push(this.glow, this.core, this.ring);
    if (this.art) this.parts.push(this.art);

    this.pulse = scene.tweens.add({
      targets: [this.glow, this.core],
      scale: "*=1.12",
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });

    this.setProgress(1, 3);
  }

  /** `step` seals confirmed out of `total` for the jutsu being formed. */
  setProgress(step: number, total: number): void {
    if (this.done) return;
    const next = Phaser.Math.Clamp(step / Math.max(1, total), 0.15, 1);
    const grew = next > this.t + 0.001;
    this.t = next;

    const coreScale = 1.6 + this.t * 4.4;
    const glowScale = 4 + this.t * 8;
    this.glow.setScale(glowScale).setAlpha(0.18 + this.t * 0.22);
    this.core.setScale(coreScale).setAlpha(0.7 + this.t * 0.3);
    this.art?.setDisplaySize(50 + this.t * 130, 50 + this.t * 130).setAlpha(0.25 + this.t * 0.6);
    this.ring.frequency = 120 - this.t * 90;

    if (grew) {
      // punch on each new seal
      this.scene.tweens.add({
        targets: this.art ? [this.core, this.art] : [this.core],
        scale: "*=1.25",
        duration: 110,
        yoyo: true,
        ease: "Quad.out",
      });
      this.ring.explode(10);
    }
  }

  /** hand-off to the thrown projectile: quick bright flare, then gone */
  release(): void {
    if (this.done) return;
    this.done = true;
    this.pulse?.stop();
    this.ring.stop();
    this.scene.tweens.add({
      targets: this.movers,
      scale: "*=1.5",
      alpha: 0,
      duration: 160,
      ease: "Quad.out",
      onComplete: () => this.destroy(),
    });
  }

  /** sequence abandoned — shrink away */
  dismiss(): void {
    if (this.done) return;
    this.done = true;
    this.pulse?.stop();
    this.ring.stop();
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
    this.pulse?.stop();
    this.parts.forEach((p) => p.destroy());
    this.parts.length = 0;
    this.done = true;
  }
}
