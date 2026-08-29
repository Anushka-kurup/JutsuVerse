import Phaser from "phaser";
import { SkillEffect, type ProjectileOpts } from "../entities/SkillEffect";

/**
 * Spec §4.2 layer 3 owner. Spawns SkillEffect instances and forgets about them
 * (each one self-destroys); keeps a list only so the scene can wipe the layer
 * on shutdown / rematch.
 */
export class EffectsLayer {
  private readonly live: SkillEffect[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  projectile(opts: ProjectileOpts): void {
    this.reap();
    this.live.push(new SkillEffect(this.scene, opts));
  }

  /**
   * Throw `count` projectiles as one volley — level 1/2/3 attacks fire 1/2/3
   * shots. They're staggered in time and fanned vertically so they read as a
   * barrage rather than a single blob; `onArrive` runs once, on the last shot.
   */
  volley(opts: ProjectileOpts, count: number): void {
    const n = Math.max(1, Math.min(3, Math.floor(count)));
    const STAGGER_MS = 130;
    const FAN = 24; // vertical spacing between shots at the target
    for (let i = 0; i < n; i++) {
      const offset = n === 1 ? 0 : (i - (n - 1) / 2) * FAN;
      const shot: ProjectileOpts = {
        ...opts,
        fromY: opts.fromY + offset * 0.35,
        toY: opts.toY + offset,
        onArrive: i === n - 1 ? opts.onArrive : undefined,
      };
      if (i === 0) this.projectile(shot);
      else this.scene.time.delayedCall(i * STAGGER_MS, () => this.projectile(shot));
    }
  }

  clash(x: number, y: number): void {
    const flash = this.scene.add.circle(x, y, 12, 0xffffff, 0.95).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      radius: 84,
      alpha: 0,
      duration: 260,
      ease: "Quad.out",
      onComplete: () => flash.destroy(),
    });
    this.scene.cameras.main.shake(160, 0.006);
  }

  clear(): void {
    this.live.forEach((e) => e.destroy());
    this.live.length = 0;
  }

  private reap(): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (this.live[i].finished) this.live.splice(i, 1);
    }
  }
}
