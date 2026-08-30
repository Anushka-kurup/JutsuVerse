import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The trained label set lives in frontend/public/memes/labels.csv (see
// frontend/public/memes/features.py's load_labels). The *challenge* pool is
// narrower: only labels that also have a meme image in memes/img/ — dropping a
// file named <label>.<ext> in there is all it takes to add a meme, and removing
// it takes that meme back out (the client shows the image when the race opens).
const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMES_DIR = resolve(__dirname, "../../frontend/public/memes");
const LABELS_PATH = resolve(MEMES_DIR, "labels.csv");
const IMG_DIR = resolve(MEMES_DIR, "img");
// files under frontend/public/ are served at "<BASE_URL>memes/img/<file>"
const IMG_WEB_PREFIX = "memes/img/";

// Labels kept out of the challenge pool even though their image is present:
//   - six_seven has its own dedicated rep-counting contest (the "special" phase)
//   - drake_no / drake_yes / thinking_monkey classify too unreliably to be fair
// (drop a label from here to bring it back — the image is still shipped).
const EXCLUDED_FROM_CHALLENGES = new Set([
  "six_seven",
  "drake_no",
  "drake_yes",
  "thinking_monkey",
]);

/** label → image filename, from whatever's actually in memes/img/. */
const MEME_IMAGE_FILES: Map<string, string> = (() => {
  const map = new Map<string, string>();
  let files: string[];
  try {
    files = readdirSync(IMG_DIR);
  } catch {
    return map; // no image dir yet — the fallback below keeps things working
  }
  for (const file of files) {
    const ext = extname(file);
    if (!/^\.(png|jpe?g|webp|gif|avif)$/i.test(ext)) continue;
    map.set(basename(file, ext), file);
  }
  return map;
})();

const TRAINED_LABELS = readFileSync(LABELS_PATH, "utf-8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((label) => !EXCLUDED_FROM_CHALLENGES.has(label));

/** The pool the memegate/memerace picks from: trained labels that have an
 * image. Falls back to every trained label if no images are installed, so a
 * bare checkout still runs. */
export const MEME_LABELS: string[] = MEME_IMAGE_FILES.size
  ? TRAINED_LABELS.filter((label) => MEME_IMAGE_FILES.has(label))
  : TRAINED_LABELS;

/** Web path (under the frontend BASE_URL) of a label's meme image, or "". */
export function memeImagePath(label: string): string {
  const file = MEME_IMAGE_FILES.get(label);
  return file ? IMG_WEB_PREFIX + file : "";
}

export function pickMemeLabel(): string {
  return MEME_LABELS[Math.floor(Math.random() * MEME_LABELS.length)];
}
