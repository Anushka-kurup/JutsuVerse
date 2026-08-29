import Phaser from "phaser";
import "./style.css";
import { gameConfig } from "./core/GameConfig";
import { Overlay } from "./ui/Overlay";

// DOM overlay (connect form, camera preview mount, sign pad, log) first —
// GameConfig.parent = "stage", which Overlay.mount() creates.
Overlay.mount();

export const game = new Phaser.Game(gameConfig);

// nudge the ScaleManager once layout has settled so FIT measures the
// #stage box (100vh - dock), not a pre-layout size
requestAnimationFrame(() => game.scale.refresh());
