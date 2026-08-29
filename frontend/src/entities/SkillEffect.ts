import Phaser from "phaser";

const ELEMENT_COLOR: Record<string, number> = {
  FIRE: 0xff7043,
  WATER: 0x35a7ff,
  WIND: 0x74e39b,
};

export interface ProjectileOpts {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  element: string;
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

    const orb = scene.add.image(opts.fromX, opts.fromY, "disc").setTint(color).setScale(1.6);
    orb.setBlendMode(Phaser.BlendModes.ADD);
    this.parts.push(orb);

    const trail = scene.add.particles(opts.fromX, opts.fromY, "disc", {
      follow: orb,
      speed: 0,
      lifespan: 260,
      scale: { start: 1.1, end: 0 },
      tint: color,
      quantity: 2,
      blendMode: "ADD",
    });
    this.parts.push(trail);

    scene.tweens.add({
      targets: orb,
      x: opts.toX,
      y: opts.toY,
      duration: 240,
      ease: "Quad.in",
      onComplete: () => {
        trail.stop();
        this.burst(opts.toX, opts.toY, color);
        orb.destroy();
        opts.onArrive?.();
        scene.time.delayedCall(500, () => this.destroy());
      },
    });
  }

  private burst(x: number, y: number, color: number): void {
    const ring = this.scene.add.circle(x, y, 6, color, 0.85).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring,
      radius: 60,
      alpha: 0,
      duration: 320,
      ease: "Quad.out",
      onComplete: () => ring.destroy(),
    });
    const spray = this.scene.add.particles(x, y, "disc", {
      speed: { min: 90, max: 260 },
      lifespan: 420,
      scale: { start: 1.2, end: 0 },
      tint: color,
      quantity: 20,
      blendMode: "ADD",
      emitting: false,
    });
    spray.explode(20, x, y);
    this.parts.push(spray);
    this.scene.time.delayedCall(500, () => spray.destroy());
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
