import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The one source of truth for the label set is frontend/public/memes/labels.csv
// (see frontend/public/memes/features.py's load_labels) — reading it directly
// here means a custom dataset (edit that file, recapture, retrain) just works
// without also needing to touch the server.
const __dirname = dirname(fileURLToPath(import.meta.url));
const LABELS_PATH = resolve(__dirname, "../../frontend/public/memes/labels.csv");

// six_seven has its own dedicated rep-counting contest (the "special" phase) —
// it isn't a pick-and-perform-once gesture, so it's excluded from the pool
// the meme-challenge (memegate/memerace) picks a random label from.
const EXCLUDED_FROM_CHALLENGES = new Set(["six_seven"]);

export const MEME_LABELS: string[] = readFileSync(LABELS_PATH, "utf-8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((label) => !EXCLUDED_FROM_CHALLENGES.has(label));

export function pickMemeLabel(): string {
  return MEME_LABELS[Math.floor(Math.random() * MEME_LABELS.length)];
}
