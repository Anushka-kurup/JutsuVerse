import Phaser from "phaser";
import { SKILLS } from "../types";

/**
 * Spec §4.3 BootScene. Loads the fighter art and bakes a couple of helper
 * textures. The character PNGs (public/assets/chars/{me,opp}.png) have white
 * paper backgrounds, so they get a white → transparent pass before use.
 */
const BASE = import.meta.env.BASE_URL;

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    this.load.image("char-me-raw", `${BASE}assets/chars/me.png`);
    this.load.image("char-opp-raw", `${BASE}assets/chars/opp.png`);
    this.load.image("bg-arena", `${BASE}assets/backgrounds/arena2.jpeg`);
    for (const skill of SKILLS) {
      if (skill.image) this.load.image(`jutsu-${skill.id}`, `${BASE}${skill.image}`);
    }
  }

  create(): void {
    this.makeDisc("disc", 8);
    this.makeNinja("ninja"); // fallback if a char image fails to load
    this.keyOutWhite("char-me-raw", "char-me");
    this.keyOutWhite("char-opp-raw", "char-opp");
    this.scene.start("Menu");
  }

  /** Copy a loaded texture to a canvas texture with near-white pixels made transparent. */
  private keyOutWhite(srcKey: string, dstKey: string): void {
    if (this.textures.exists(dstKey)) return;
    if (!this.textures.exists(srcKey)) return;
    const src = this.textures.get(srcKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const w = src.width;
    const h = src.height;
    const tex = this.textures.createCanvas(dstKey, w, h);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.drawImage(src as CanvasImageSource, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) d[i + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }

  private makeDisc(key: string, r: number): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillCircle(r, r, r);
    g.generateTexture(key, r * 2, r * 2);
    g.destroy();
  }

  private makeNinja(key: string): void {
    const w = 54;
    const h = 96;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(10, 30, w - 20, h - 30, 10);
    g.fillCircle(w / 2, 20, 14);
    g.fillRoundedRect(2, 40, 12, 30, 5);
    g.fillRoundedRect(w - 14, 40, 12, 30, 5);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
