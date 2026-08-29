import Phaser from "phaser";
import { STAGE_HEIGHT, STAGE_WIDTH, GROUND_Y } from "../core/GameConfig";

/**
 * Spec §4.2 layer 1. Pure scenery — never touched by battle logic. Everything
 * here is `setScrollFactor(0)` and gets a slow drift so a future camera shake
 * or parallax pass has something to move against.
 */
export class BackgroundLayer {
  constructor(scene: Phaser.Scene) {
    // sky gradient (two stacked rects — cheap stand-in for real art)
    scene.add.rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0x141a2e).setOrigin(0).setScrollFactor(0);
    scene.add
      .rectangle(0, STAGE_HEIGHT * 0.45, STAGE_WIDTH, STAGE_HEIGHT * 0.55, 0x0d1120)
      .setOrigin(0)
      .setScrollFactor(0);

    // far ridgeline
    const far = scene.add.graphics().setScrollFactor(0);
    far.fillStyle(0x1c2440, 1);
    far.beginPath();
    far.moveTo(0, GROUND_Y);
    for (let x = 0; x <= STAGE_WIDTH; x += 120) {
      far.lineTo(x + 60, GROUND_Y - 120 - ((x / 120) % 2) * 40);
      far.lineTo(x + 120, GROUND_Y);
    }
    far.closePath();
    far.fillPath();

    // a lazy drift so the scene isn't dead-still
    scene.tweens.add({
      targets: far,
      x: -24,
      duration: 8000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });

    // arena floor
    scene.add
      .rectangle(0, GROUND_Y, STAGE_WIDTH, STAGE_HEIGHT - GROUND_Y, 0x0a0d16)
      .setOrigin(0)
      .setScrollFactor(0);
    scene.add.rectangle(0, GROUND_Y, STAGE_WIDTH, 3, 0x3a4a7a).setOrigin(0).setScrollFactor(0);
  }
}
