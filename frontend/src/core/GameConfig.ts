import Phaser from "phaser";
import { BootScene } from "../scenes/BootScene";
import { MenuScene } from "../scenes/MenuScene";
import { BattleScene } from "../scenes/BattleScene";
import { ResultScene } from "../scenes/ResultScene";

/** Internal render resolution. The canvas is scaled to fit the viewport. */
export const STAGE_WIDTH = 960;
export const STAGE_HEIGHT = 540;
export const GROUND_Y = STAGE_HEIGHT - 76;

/** Standing positions for the two fighters, spec §4.2 "角色層" (left/right). */
export const SPAWN = {
  me: { x: 250, y: GROUND_Y },
  opp: { x: STAGE_WIDTH - 250, y: GROUND_Y },
} as const;

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "stage",
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT,
  backgroundColor: "#070a11",
  render: { antialias: true, pixelArt: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, BattleScene, ResultScene],
};
