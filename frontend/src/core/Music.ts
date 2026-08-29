const BGM_URL = `${import.meta.env.BASE_URL}audio/bgm.m4a`;

/** Background music sits well under the effects — it should never fight a jutsu. */
const BGM_VOLUME = 0.12;

/**
 * Looping background music.
 *
 * A plain <audio> element rather than Phaser's sound manager, for two reasons:
 * it streams, so a 3 MB track starts playing long before it has finished
 * downloading; and it is not owned by a scene, so it survives Menu → Battle →
 * Result without being torn down and restarted.
 *
 * Browsers refuse to play audio until the page has been interacted with, so the
 * first `play()` is expected to fail — we retry on the player's first click or
 * keypress, which on this game is pressing Create/Join on the menu.
 */
class MusicController {
  private el: HTMLAudioElement | null = null;
  private volume = BGM_VOLUME;
  private muted = false;
  private waiting = false;

  start(): void {
    if (this.el) return;
    const el = new Audio(BGM_URL);
    el.loop = true;
    el.preload = "auto";
    el.volume = this.volume;
    el.addEventListener("error", () => {
      console.warn(`[Music] no track at ${BGM_URL} — drop an .m4a there to enable music`);
    });
    this.el = el;
    this.play();
  }

  private play(): void {
    const el = this.el;
    if (!el || this.muted) return;
    el.play().catch(() => this.waitForGesture());
  }

  /** Autoplay was blocked — start the moment the player touches the page. */
  private waitForGesture(): void {
    if (this.waiting) return;
    this.waiting = true;
    const resume = (): void => {
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      this.waiting = false;
      this.play();
    };
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Returns the new muted state, so a caller can report it. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (!this.el) return this.muted;
    if (this.muted) this.el.pause();
    else this.play();
    return this.muted;
  }

  /** 0‥1. Use to duck the music under a moment that needs the room. */
  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.el) this.el.volume = this.volume;
  }
}

export const music = new MusicController();
