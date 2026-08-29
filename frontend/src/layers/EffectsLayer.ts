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
