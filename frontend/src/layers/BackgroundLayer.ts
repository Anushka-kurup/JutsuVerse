import Phaser from "phaser";
import { STAGE_HEIGHT, STAGE_WIDTH, GROUND_Y } from "../core/GameConfig";

/**
 * Spec §4.2 layer 1. Pure scenery — never touched by battle logic. The arena
 * photo (public/assets/backgrounds/arena.png) is scaled to cover the stage;
 * a soft dark wash + a ground shadow keep the fighters and HUD readable.
 */
export class BackgroundLayer {
  constructor(scene: Phaser.Scene) {
    if (scene.textures.exists("bg-arena")) {
      const bg = scene.add.image(STAGE_WIDTH / 2, STAGE_HEIGHT / 2, "bg-arena").setScrollFactor(0);
      const cover = Math.max(STAGE_WIDTH / bg.width, STAGE_HEIGHT / bg.height);
      bg.setScale(cover);
      // no parallax drift — must stay aligned with the CSS arena that fills the
      // FIT letterbox around the canvas (see #stage in style.css)
    } else {
      scene.add.rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0x141a2e).setOrigin(0).setScrollFactor(0);
    }

    // dark wash so bright scenery doesn't drown the sprites / HUD
    scene.add.rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0x0a0d16, 0.32).setOrigin(0).setScrollFactor(0);
    // bottom vignette + ground shadow where the fighters stand
    scene.add
      .rectangle(0, STAGE_HEIGHT, STAGE_WIDTH, STAGE_HEIGHT * 0.4, 0x05070c, 0.55)
      .setOrigin(0, 1)
      .setScrollFactor(0);
    scene.add
      .ellipse(STAGE_WIDTH / 2, GROUND_Y + 6, STAGE_WIDTH * 1.1, 60, 0x000000, 0.35)
      .setScrollFactor(0);
  }
}
