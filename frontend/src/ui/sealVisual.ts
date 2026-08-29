import { signById } from "../types";

/**
 * Renders a seal / skill as an <img>, falling back to text when the image is
 * missing (drop PNGs into public/assets/seals/<id>.png and .../skills/<id>.png).
 * The <img> sits on top of the text; `onerror` removes it so the text shows.
 */
const SEALS = `${import.meta.env.BASE_URL}assets/seals/`;

export function sealHtml(id: string, extraClass = ""): string {
  const s = signById(id);
  return `<span class="seal-cell ${extraClass}" data-seal="${id}" title="${s?.en ?? id}">
    <img src="${SEALS}${id}.png" alt="${id}" onerror="this.remove()" />
    <b>${s?.kanji ?? "?"}</b>
  </span>`;
}

/** kanji only, no image — for tight HUD strips where a photo crop is unreadable */
export function sealTextHtml(id: string, extraClass = ""): string {
  const s = signById(id);
  return `<span class="seal-cell seal-cell--text ${extraClass}" data-seal="${id}" title="${s?.en ?? id}">
    <b>${s?.kanji ?? "?"}</b>
  </span>`;
}

