/**
 * Meme Game Lab (meme.html) — a standalone page for the meme challenge only.
 *
 * Pick one meme as the target, perform it on camera, and watch the live
 * classifier readout. It drives the exact same MemeBridge the game uses, so the
 * confidence, thresholds and "PASS" verdict here match what a real memegate /
 * memerace would award.
 */
import { bus, Events } from "../core/EventBus";
import { loadMemeForest } from "../gesture/memeForest";
import { MEME_MIN_CONFIDENCE, MemeBridge, type MemeDebug } from "../gesture/MemeBridge";

const BASE = import.meta.env.BASE_URL;

// label → file under frontend/public/memes/img/. Keep in sync with what's there
// (this is what the server pools from too). A label with no entry still shows in
// the picker as a text tile, so you can test how the model does on it anyway.
const IMG: Record<string, string> = {
  dab: "dab.jpeg",
  drake_yes: "drake_yes.jpeg",
  drake_no: "drake_no.jpg",
  italian_hand: "italian_hand.png",
  korean_heart: "korean_heart.jpeg",
  mog: "mog.gif",
  shocked_guy: "shocked_guy.gif",
  thinking_monkey: "thinking_monkey.webp",
};

const video = document.querySelector<HTMLVideoElement>("#video")!;
const picker = document.querySelector<HTMLDivElement>("#picker")!;
const readout = document.querySelector<HTMLPreElement>("#readout")!;
const flash = document.querySelector<HTMLDivElement>("#flash")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop")!;
const retryBtn = document.querySelector<HTMLButtonElement>("#retry")!;

let bridge: MemeBridge | null = null;
let stream: MediaStream | null = null;
let target = "";
let hits = 0;

async function buildPicker(): Promise<void> {
  let labels: string[];
  try {
    labels = (await loadMemeForest()).labels;
  } catch {
    labels = Object.keys(IMG); // model not loaded yet — fall back to the known set
  }
  for (const label of labels) {
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.dataset.label = label;
    const file = IMG[label];
    btn.innerHTML = file
      ? `<img src="${BASE}memes/img/${file}" alt=""><span>${label}</span>`
      : `<span class="noimg">no image</span><span>${label}</span>`;
    btn.addEventListener("click", () => selectTarget(label));
    picker.appendChild(btn);
  }
  if (labels[0]) selectTarget(labels[0]);
}

function selectTarget(label: string): void {
  target = label;
  hits = 0;
  for (const el of picker.querySelectorAll<HTMLElement>(".pick")) {
    el.classList.toggle("on", el.dataset.label === label);
  }
  bridge?.setTarget(label);
}

async function start(): Promise<void> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  } catch (err) {
    readout.textContent = `camera failed: ${String(err)}`;
    return;
  }
  video.srcObject = stream;
  await video.play();

  bridge = new MemeBridge(video);
  if (target) bridge.setTarget(target);
  readout.textContent = "loading pose + hand models…";
  try {
    await bridge.start();
  } catch (err) {
    readout.textContent = `model failed to start: ${String(err)}`;
    return;
  }
  startBtn.disabled = true;
  stopBtn.disabled = false;
  retryBtn.disabled = false;
  requestAnimationFrame(render);
}

function stop(): void {
  bridge?.stop();
  bridge = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  retryBtn.disabled = true;
}

startBtn.addEventListener("click", () => void start());
stopBtn.addEventListener("click", stop);
retryBtn.addEventListener("click", () => bridge?.reset()); // un-latch without dropping arms

bus.on(Events.MEME_RECOGNIZED, (p: { label: string }) => {
  hits += 1;
  flash.textContent = `✓  ${p.label.replace(/_/g, " ").toUpperCase()}`;
  flash.classList.add("show");
  window.setTimeout(() => flash.classList.remove("show"), 1000);
});

// ── live readout ────────────────────────────────────────────────
const pct = (c: number) => `${(c * 100).toFixed(0)}%`.padStart(4);
const bar = (c: number) => "█".repeat(Math.round(c * 24)).padEnd(24, "·");

function lines(m: MemeDebug): string {
  const targetLeads = m.top[0]?.label === m.target;
  const passes = targetLeads || m.targetConf >= MEME_MIN_CONFIDENCE;
  const rank = (m.top.findIndex((e) => e.label === m.target) + 1) || 0;
  const rows = m.top
    .map(
      (e) =>
        `  ${e.label === m.target ? "▶" : " "} ${e.label.padEnd(16)} ${pct(e.confidence)}  ${bar(e.confidence)}`,
    )
    .join("\n");
  return [
    `${bridge?.active ? "running" : "idle"}   ${m.tracked ? "arms/hands OK" : "NO ARMS/HANDS IN FRAME"}   window ${Math.round(m.windowMs)}ms${m.latched ? "   LATCHED" : ""}`,
    ``,
    `target : ${m.target ?? "(none)"}   ${targetLeads ? "TOP-1" : rank ? `ranked #${rank}` : "outside top 5"}`,
    `conf   : ${pct(m.targetConf)}  ${bar(m.targetConf)}`,
    `pass if: target is the top result   or   conf ≥ ${pct(MEME_MIN_CONFIDENCE)}    →   ${passes ? "PASS" : "…"}`,
    `hits   : ${hits}`,
    ``,
    `all classes (highest first):`,
    rows || "  (no window yet — get your arms in frame)",
  ].join("\n");
}

function render(): void {
  if (!bridge) return;
  readout.textContent = lines(bridge.debug);
  requestAnimationFrame(render);
}

void buildPicker();
