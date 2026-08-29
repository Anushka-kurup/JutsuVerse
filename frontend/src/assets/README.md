# assets/

Spec §4.3 asset folders. Empty for now — the game boots on placeholder textures
generated in `scenes/BootScene.ts` (`disc`, `ninja`).

To use real art, drop files here and load them in `BootScene.preload()`:

```
sprites/       character spritesheets (idle / cast / hit / ko frames)
backgrounds/   parallax layers for BackgroundLayer
effects/       particle textures, per-element skill sheets
```

Example swap in `BootScene`:

```ts
preload() {
  this.load.spritesheet("ninja", "assets/sprites/ninja.png", { frameWidth: 96, frameHeight: 96 });
  this.load.image("bg-far", "assets/backgrounds/ridge.png");
}
```

Vite serves `src/assets/**` when referenced by URL; for many files prefer a
top-level `public/assets/` instead and load by absolute path.
