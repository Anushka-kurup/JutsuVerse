import Phaser from "phaser";
import { ChargeEffect, type ChargeOpts } from "../entities/ChargeEffect";
import { SkillEffect, type ProjectileOpts } from "../entities/SkillEffect";
import type { Side } from "../types";

/**
 * Spec §4.2 layer 3 owner. Spawns SkillEffect instances and forgets about them
 * (each one self-destroys); keeps a list only so the scene can wipe the layer
 * on shutdown / rematch. Also owns the per-side "charging jutsu" visual.
 */
export class EffectsLayer {
  private readonly live: SkillEffect[] = [];
  private readonly charges: Partial<Record<Side, ChargeEffect>> = {};

  constructor(private readonly scene: Phaser.Scene) {}

  /** Grow the charge for `side` as its seal sequence progresses. */
  charge(side: Side, opts: ChargeOpts, step: number, total: number): void {
    let c = this.charges[side];
    if (c && c.skillId !== opts.skillId) {
      c.dismiss();
      c = undefined;
    }
    if (!c) {
      c = new ChargeEffect(this.scene, opts);
      this.charges[side] = c;
    }
    c.setProgress(step, total);
  }

  /**
   * The jutsu fired — flare the charge out (the projectile takes over). Returns
   * the size + how many copies charged, so the volley throws that many at that
   * size. `count` is 0 when nothing was charging.
   */
  releaseCharge(side: Side): { artSize?: number; count: number } {
    const c = this.charges[side];
    const size = c?.artSize ?? 0;
    const count = c?.count ?? 0;
    c?.release();
    delete this.charges[side];
    return { artSize: size > 0 ? size : undefined, count };
  }

  /** Sequence abandoned / no longer an attack — fade the charge. */
  clearCharge(side: Side): void {
    this.charges[side]?.dismiss();
    delete this.charges[side];
  }

  projectile(opts: ProjectileOpts): void {
    this.reap();
    this.live.push(new SkillEffect(this.scene, opts));
  }

  /**
   * Throw `count` projectiles as one volley — level 1/2 attacks fire 1/2
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
    for (const side of Object.keys(this.charges) as Side[]) {
      this.charges[side]?.destroy();
      delete this.charges[side];
    }
  }

  private reap(): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (this.live[i].finished) this.live.splice(i, 1);
    }
  }
}
