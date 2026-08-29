const BASE = `${import.meta.env.BASE_URL}audio/sfx/`;

/**
 * One-shots sit far above the music (0.12) so a jutsu always cuts through it.
 * Linear amplitude, so this is roughly six times the music's level.
 */
const SFX_VOLUME = 0.7;

/**
 * Clips that exist today, keyed by the element id used in shared/skills.ts.
 * Adding water, wind or earth is dropping `<element>.mp3` into
 * public/audio/sfx/ and adding its name here — nothing else changes.
 */
const CLIPS = ["fire", "water"] as const;

/**
 * Short attack sounds, played as fire-and-forget one-shots.
 *
 * Each clip is fetched once into a template element; every play clones that
 * template so two casts layer instead of cutting each other off. Clones are
 * served from the browser cache, so the extra elements cost no extra request.
 */
class SfxController {
  private readonly templates = new Map<string, HTMLAudioElement>();
  private volume = SFX_VOLUME;
  private muted = false;

  preload(): void {
    for (const name of CLIPS) {
      const url = `${BASE}${name}.mp3`;
      const el = new Audio(url);
      el.preload = "auto";
      el.volume = this.volume;
      el.addEventListener("error", () => console.warn(`[Sfx] missing clip: ${url}`));
      this.templates.set(name, el);
    }
  }

  /** `name` is a lowercase element id — unknown names are simply silent. */
  play(name: string): void {
    if (this.muted) return;
    const template = this.templates.get(name);
    if (!template) return;
    const shot = template.cloneNode(true) as HTMLAudioElement;
    shot.volume = this.volume;
    // a blocked play (before the first click) is not worth surfacing
    shot.play().catch(() => {});
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** 0‥1 */
  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
  }
}

export const sfx = new SfxController();
