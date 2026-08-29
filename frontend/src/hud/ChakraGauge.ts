import Phaser from "phaser";

const W = 300;
const H = 9;

/** Thin chakra/energy bar that sits just under the HP bar. */
export class ChakraGauge {
  readonly container: Phaser.GameObjects.Container;
  private readonly fill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, align: -1 | 1) {
    const originX = align === -1 ? 0 : 1;
    const frame = scene.add.rectangle(0, 0, W, H, 0x0a0d16).setOrigin(originX, 0.5).setStrokeStyle(1, 0x2c3346);
    this.fill = scene.add.rectangle(0, 0, W, H, 0x35d0ba).setOrigin(originX, 0.5);

    this.container = scene.add.container(x, y, [frame, this.fill]);
    this.container.setScrollFactor(0);
  }

  set(energy: number, max = 100): void {
    const v = Phaser.Math.Clamp(energy, 0, max);
    this.fill.width = (v / max) * W;
    this.fill.fillColor = v / max < 0.2 ? 0x4a5568 : 0x35d0ba;
  }
}
