import Phaser from "phaser";

const W = 340;
const H = 18;

/**
 * Top-of-screen HP bar, one per fighter. `align: -1` anchors it to the left and
 * drains rightward; `align: 1` mirrors it for the opponent.
 */
export class HealthBar {
  readonly container: Phaser.GameObjects.Container;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private value = 100;

  constructor(scene: Phaser.Scene, x: number, y: number, align: -1 | 1, name: string) {
    const originX = align === -1 ? 0 : 1;

    const frame = scene.add.rectangle(0, 0, W, H, 0x0a0d16).setOrigin(originX, 0.5).setStrokeStyle(2, 0x2c3346);
    this.fill = scene.add.rectangle(0, 0, W, H, 0xff5470).setOrigin(originX, 0.5);
    this.label = scene.add
      .text(align === -1 ? 0 : 0, -H, `${name}  100`, { fontFamily: "monospace", fontSize: "13px", color: "#c8d0e4" })
      .setOrigin(originX, 1);

    this.container = scene.add.container(x, y, [frame, this.fill, this.label]);
    this.container.setScrollFactor(0);
  }

  set(hp: number, max = 100): void {
    const next = Phaser.Math.Clamp(hp, 0, max);
    this.value = next;
    const w = (next / max) * W;
    this.fill.width = w;
    this.fill.fillColor = next / max < 0.25 ? 0xff2d55 : next / max < 0.5 ? 0xff8a5b : 0xff5470;
    this.label.setText(`${this.label.text.split("  ")[0]}  ${Math.round(next)}`);
  }

  get hp(): number {
    return this.value;
  }
}
