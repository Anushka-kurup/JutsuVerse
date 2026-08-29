import Phaser from "phaser";
import { MAX_SHIELDS } from "@jutsu/protocol";

const SIZE = 14;
const GAP = 6;

/** Row of shield pips that sits just under the HP bar. */
export class ShieldRow {
  readonly container: Phaser.GameObjects.Container;
  private readonly pips: Phaser.GameObjects.Rectangle[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number, align: -1 | 1) {
    const originX = align === -1 ? 0 : 1;
    for (let i = 0; i < MAX_SHIELDS; i++) {
      const offset = (SIZE + GAP) * i * align;
      const pip = scene.add
        .rectangle(offset, 0, SIZE, SIZE, 0x35d0ba)
        .setOrigin(originX, 0.5)
        .setStrokeStyle(1, 0x2c3346);
      this.pips.push(pip);
    }
    this.container = scene.add.container(x, y, this.pips);
    this.container.setScrollFactor(0);
  }

  set(shields: number): void {
    this.pips.forEach((pip, i) => {
      pip.fillColor = i < shields ? 0x35d0ba : 0x1a1f2e;
    });
  }
}
