import Phaser from "phaser";

const ELEMENT_COLOR: Record<string, number> = {
  FIRE: 0xff7043,
  WATER: 0x35a7ff,
  EARTH: 0xc38b52,
};

export interface ProjectileOpts {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  element: string;
  skillId: string;
  level: number;
  /** Launch size for the art, in px — set to whatever the charge grew to. */
  artSize?: number;
  onArrive?: () => void;
}

/**
 * Spec §4.2 layer 3. One skill's worth of particles: a travelling orb that
 * bursts on arrival. Owns its own lifecycle and self-destroys — EffectsLayer
 * just keeps a list so it can nuke everything on scene shutdown.
 */
export class SkillEffect {
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private done = false;

  constructor(
    private readonly scene: Phaser.Scene,
    opts: ProjectileOpts,
  ) {
    const color = ELEMENT_COLOR[opts.element] ?? 0xffffff;
    const dir = Math.sign(opts.toX - opts.fromX) || 1;
    // Level 1 flies as a small tight bolt; Level 2 gets a big halo
    const l2 = opts.level >= 2;
    const g = l2 ? 1 : 0.4;

    const glow = scene.add
      .image(opts.fromX, opts.fromY, "disc")
      .setTint(color)
      .setScale(l2 ? 11 : 2.4)
      .setAlpha(l2 ? 0.3 : 0.22);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    const orb = scene.add.image(opts.fromX, opts.fromY, "disc").setTint(color).setScale(3.2 * g);
    orb.setBlendMode(Phaser.BlendModes.ADD);
    this.parts.push(glow, orb);

    const textureKey = `jutsu-${opts.skillId}`;
    const artSize = opts.artSize ?? 100 + opts.level * 24;
    const art = scene.textures.exists(textureKey)
      ? scene.add
          .image(opts.fromX, opts.fromY, textureKey)
          .setDisplaySize(artSize, artSize)
          .setFlipX(dir > 0)
          .setDepth(8)
      : null;
    if (art) this.parts.push(art);

    const trail = scene.add.particles(opts.fromX, opts.fromY, "disc", {
      follow: orb,
      speed: { min: 20, max: 90 },
      angle: { min: 160 - dir * 20, max: 200 - dir * 20 },
      lifespan: 420,
      scale: { start: 2.2 * g, end: 0 },
      tint: color,
      quantity: opts.level >= 2 ? 3 : 2,
      blendMode: "ADD",
    });
    this.parts.push(trail);

    // slight upward arc across the arena
    const midY = (opts.fromY + opts.toY) / 2 - 46;
    scene.tweens.chain({
      targets: art ? [orb, glow, art] : [orb, glow],
      tweens: [
        { x: (opts.fromX + opts.toX) / 2, y: midY, duration: 460, ease: "Sine.out" },
        { x: opts.toX, y: opts.toY, duration: 440, ease: "Sine.in" },
      ],
      onComplete: () => {
        trail.stop();
        this.burst(opts.toX, opts.toY, color);
        orb.destroy();
        glow.destroy();
        art?.destroy();
        this.scene.cameras.main.shake(180, 0.009);
        opts.onArrive?.();
        scene.time.delayedCall(600, () => this.destroy());
      },
    });
  }

  private burst(x: number, y: number, color: number): void {
    const ring = this.scene.add.circle(x, y, 10, color, 0.9).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring,
      radius: 130,
      alpha: 0,
      duration: 360,
      ease: "Quad.out",
      onComplete: () => ring.destroy(),
    });
    const spray = this.scene.add.particles(x, y, "disc", {
      speed: { min: 120, max: 360 },
      lifespan: 500,
      scale: { start: 2, end: 0 },
      tint: color,
      quantity: 34,
      blendMode: "ADD",
      emitting: false,
    });
    spray.explode(34, x, y);
    this.parts.push(spray);
    this.scene.time.delayedCall(600, () => spray.destroy());
  }

  destroy(): void {
    if (this.done) return;
    this.done = true;
    this.parts.forEach((p) => p.destroy());
    this.parts.length = 0;
  }

  get finished(): boolean {
    return this.done;
  }
}
