import Phaser from "phaser";
import { bus, Events } from "../core/EventBus";
import { STAGE_HEIGHT, STAGE_WIDTH } from "../core/GameConfig";
import { net } from "../core/Session";
import type { Phase } from "../types";

interface ResultData {
  winner: string;
  iWon: boolean;
}

/**
 * Launched *over* BattleScene so the frozen arena shows behind the banner.
 * Rematch asks the server to reset; the next non-"ended" phase closes this.
 */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super("Result");
  }

  create(data: ResultData): void {
    const cx = STAGE_WIDTH / 2;
    const cy = STAGE_HEIGHT / 2;

    this.add.rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT, 0x05070c, 0.55).setOrigin(0);
    this.add
      .text(cx, cy - 30, data.iWon ? "YOU WIN" : "YOU LOSE", {
        fontFamily: "Impact, system-ui, sans-serif",
        fontSize: "64px",
        color: data.iWon ? "#4ade80" : "#ff5470",
      })
      .setOrigin(0.5);

    const btn = this.add
      .text(cx, cy + 44, "▶  REMATCH", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#eef1f8",
        backgroundColor: "#4f7dff",
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    btn.on("pointerover", () => btn.setStyle({ backgroundColor: "#3d67e6" }));
    btn.on("pointerout", () => btn.setStyle({ backgroundColor: "#4f7dff" }));
    btn.on("pointerdown", () => {
      net.reset();
      btn.setText("…");
    });

    bus.on(Events.NET_MATCH, this.onMatch, this);
    bus.on(Events.NET_CLOSE, this.close, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off(Events.NET_MATCH, this.onMatch, this);
      bus.off(Events.NET_CLOSE, this.close, this);
    });
  }

  private onMatch(m: { phase: Phase }): void {
    if (m.phase !== "ended") this.close();
  }

  private close(): void {
    this.scene.stop();
  }
}
