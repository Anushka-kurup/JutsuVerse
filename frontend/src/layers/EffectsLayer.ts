import Phaser from "phaser";
import { ChargeEffect, type ChargeOpts } from "../entities/ChargeEffect";
import { SkillEffect, type ProjectileOpts } from "../entities/SkillEffect";
import type { Side } from "../types";

// ── 6-7 contest forfeit: Wind1 art raining on the loser ──
const GUST_KEY = "wind-gust";
const GUST_COUNT = 3;
const GUST_SIZE = 120;
const GUST_SPREAD = 46; // horizontal gap between where each one lands
const GUST_STAGGER_MS = 130;
const GUST_FALL_MS = 420;
const GUST_LAND_DY = 120; // land on the torso, not at the feet

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
    if (c && c.element !== opts.element) {
      c.dismiss(); // switched to a different element — start over
      c = undefined;
    }
    if (!c) {
      c = new ChargeEffect(this.scene, opts);
      this.charges[side] = c;
    } else {
      c.retarget(opts.skillId, opts.withGlow); // same element, maybe L1 → L2
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

  /**
   * Gusts falling onto the fighter standing at (x, y) — the 6-7 contest's
   * loser. They fall fast and land staggered so the last one hits hardest,
   * arriving just after the damage flash so it reads as the cause of it.
   */
  rain(x: number, y: number, count = GUST_COUNT): void {
    if (!this.scene.textures.exists(GUST_KEY)) return;
    const n = Math.max(1, Math.min(5, Math.floor(count)));
    for (let i = 0; i < n; i++) {
      const spread = n === 1 ? 0 : (i - (n - 1) / 2) * GUST_SPREAD;
      this.scene.time.delayedCall(i * GUST_STAGGER_MS, () =>
        this.gust(x + spread, y, i === n - 1),
      );
    }
  }

  private gust(x: number, y: number, last: boolean): void {
    const img = this.scene.add
      .image(x, -GUST_SIZE, GUST_KEY)
      .setDisplaySize(GUST_SIZE, GUST_SIZE)
      .setDepth(12)
      .setAngle(Phaser.Math.Between(-20, 20))
      .setAlpha(0.95);

    this.scene.tweens.add({
      targets: img,
      y: y - GUST_LAND_DY,
      duration: GUST_FALL_MS,
      ease: "Quad.in",
      onComplete: () => {
        this.scene.cameras.main.shake(130, last ? 0.007 : 0.0035);
        // flatten and fade on landing rather than just vanishing
        this.scene.tweens.add({
          targets: img,
          alpha: 0,
          scaleX: img.scaleX * 1.45,
          scaleY: img.scaleY * 0.55,
          duration: 220,
          ease: "Quad.out",
          onComplete: () => img.destroy(),
        });
      },
    });
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
