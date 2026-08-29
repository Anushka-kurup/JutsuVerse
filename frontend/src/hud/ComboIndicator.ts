import Phaser from "phaser";

/**
 * Centre-screen "COMBO x3" pop. The backend has no combo concept, so StateSync
 * counts the local player's casts inside a rolling window and calls show().
 */
export class ComboIndicator {
  private readonly text: Phaser.GameObjects.Text;
  private hideEvent?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.text = scene.add
      .text(x, y, "", {
        fontFamily: "Impact, system-ui, sans-serif",
        fontSize: "34px",
        color: "#ffd166",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setAlpha(0);
  }

  show(count: number): void {
    const scene = this.text.scene;
    this.text.setText(`COMBO ×${count}`).setAlpha(1).setScale(1.4);
    scene.tweens.add({ targets: this.text, scale: 1, duration: 180, ease: "Back.out" });

    this.hideEvent?.remove();
    this.hideEvent = scene.time.delayedCall(1400, () => {
      scene.tweens.add({ targets: this.text, alpha: 0, duration: 300 });
    });
  }
}
