import Phaser from "phaser";
import { STAGE_WIDTH } from "../core/GameConfig";
import type { FighterPublic, Side } from "../types";
import { ComboIndicator } from "./ComboIndicator";
import { HealthBar } from "./HealthBar";
import { ShieldRow } from "./ShieldRow";

interface SideWidgets {
  hp: HealthBar;
  shields: ShieldRow;
  meta: Phaser.GameObjects.Text;
}

/**
 * Spec §4.2 layer 4. Composes the three HUD widgets and keeps them pinned with
 * `setScrollFactor(0)`. The scene only ever calls `updateSide` / `showCombo`.
 */
export class Hud {
  private readonly sides: Record<Side, SideWidgets>;
  private readonly combo: ComboIndicator;

  constructor(scene: Phaser.Scene) {
    const margin = 40;
    this.sides = {
      me: this.buildSide(scene, margin, -1, "YOU"),
      opp: this.buildSide(scene, STAGE_WIDTH - margin, 1, "OPPONENT"),
    };
    this.combo = new ComboIndicator(scene, STAGE_WIDTH / 2, 120);
  }

  private buildSide(scene: Phaser.Scene, x: number, align: -1 | 1, name: string): SideWidgets {
    const hp = new HealthBar(scene, x, 40, align, name);
    const shields = new ShieldRow(scene, x, 58, align);
    const meta = scene.add
      .text(x, 70, "", { fontFamily: "monospace", fontSize: "12px", color: "#8a93ad" })
      .setOrigin(align === -1 ? 0 : 1, 0)
      .setScrollFactor(0);
    return { hp, shields, meta };
  }

  updateSide(side: Side, f: FighterPublic): void {
    const w = this.sides[side];
    w.hp.set(f.hp);
    w.shields.set(f.shields);
    const s = f.stance === "idle" ? "" : f.stance.toUpperCase();
    w.meta.setText(`HP ${Math.round(f.hp)}  SH ${f.shields}  ${s}`);
  }

  showCombo(count: number): void {
    this.combo.show(count);
  }
}
