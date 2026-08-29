import Phaser from "phaser";
import "./style.css";
import { gameConfig } from "./core/GameConfig";
import { music } from "./core/Music";
import { sfx } from "./core/Sfx";
import { Overlay } from "./ui/Overlay";

// DOM overlay (connect form, camera preview mount, sign pad, log) first —
// GameConfig.parent = "stage", which Overlay.mount() creates.
Overlay.mount();

export const game = new Phaser.Game(gameConfig);

// streams and loops in the background; starts on the player's first click
music.start();
sfx.preload();

// nudge the ScaleManager once layout has settled so FIT measures the
// #stage box (100vh - dock), not a pre-layout size
requestAnimationFrame(() => game.scale.refresh());
