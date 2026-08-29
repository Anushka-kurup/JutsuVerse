import "./style.css";
import {
  MAX_HP,
  type Edge,
  type FighterPublic,
  type Seat,
  type ServerMsg,
  type Sign,
} from "@jutsu/protocol";
import { initHandSignDetector, startCamera, stopCamera, detectFrame, drawDetections } from "./handTracker";
import { GameSocket } from "./net/wsClient";
import { KEY_MAP, MOVE_HINTS, PLAYABLE, SIGN_DEFS } from "./types";

const HYSTERESIS = 4;
const KEEP_MS = 200;
const EMPTY: FighterPublic = {
  hp: MAX_HP,
  stance: "idle",
  moveId: null,
  buffer: [],
  held: [],
  guardLeft: 0,
};

const app = document.querySelector<HTMLDivElement>("#app")!;
const socket = new GameSocket();

type Screen = "lobby" | "waiting" | "duel" | "ended";

let screen: Screen = "lobby";
let errorMsg: string | null = null;
let seat: Seat = "a";
let roomCode = "";
let youName = "Ronin";
let foeName = "Opponent";
let a: FighterPublic = EMPTY;
let b: FighterPublic = EMPTY;
let winner: Seat | "draw" | null = null;
let readySent = false;
let held = new Set<Sign>();
let signButtons: Partial<Record<Sign, HTMLButtonElement>> = {};
let keepTimer: number | null = null;
let keysBound = false;

let cameraOn = false;
let cameraLoopId: number | null = null;
let camCandidate: Sign | null = null;
let camCandidateCount = 0;
let camHeld: Sign | null = null;

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let peerPresent = false;
let pendingOffer: RTCSessionDescriptionInit | null = null;
let pendingIce: RTCIceCandidateInit[] = [];

type SignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

function emit(sign: Sign, edge: Edge) {
  if (edge === "down") held.add(sign);
  else held.delete(sign);
  signButtons[sign]?.classList.toggle("holding", held.has(sign));
  socket.send({
    type: "input",
    seq: socket.nextSeq,
    sign,
    edge,
    tClient: performance.now(),
  });
}

function releaseAll() {
  for (const sign of [...held]) emit(sign, "up");
}

function startKeepalive() {
  stopKeepalive();
  keepTimer = window.setInterval(() => {
    for (const sign of held) {
      socket.send({
        type: "input",
        seq: socket.nextSeq,
        sign,
        edge: "down",
        tClient: performance.now(),
      });
    }
  }, KEEP_MS);
}

function stopKeepalive() {
  if (keepTimer !== null) {
    window.clearInterval(keepTimer);
    keepTimer = null;
  }
}

function onKeyDown(ev: KeyboardEvent) {
  if (screen !== "duel") return;
  const target = ev.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
  const sign = KEY_MAP[ev.key];
  if (!sign || ev.repeat || held.has(sign)) return;
  ev.preventDefault();
  emit(sign, "down");
}

function onKeyUp(ev: KeyboardEvent) {
  if (screen !== "duel") return;
  const sign = KEY_MAP[ev.key];
  if (!sign || !held.has(sign)) return;
  ev.preventDefault();
  emit(sign, "up");
}

function bindKeys() {
  if (keysBound) return;
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAll);
  keysBound = true;
}

function unbindKeys() {
  if (!keysBound) return;
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", releaseAll);
  keysBound = false;
}

function enterDuel() {
  if (screen === "duel") return;
  screen = "duel";
  if (!readySent) {
    socket.send({ type: "ready" });
    readySent = true;
  }
  render();
}

function goLobby(message?: string) {
  teardownDuel();
  screen = "lobby";
  errorMsg = message ?? null;
  readySent = false;
  peerPresent = false;
  a = EMPTY;
  b = EMPTY;
  winner = null;
  foeName = "Opponent";
  roomCode = "";
  render();
}

function teardownDuel() {
  stopKeepalive();
  unbindKeys();
  releaseAll();
  shutdownCamera();
  resetWebRTC();
}

function handleServer(msg: ServerMsg) {
  switch (msg.type) {
    case "joined":
      seat = msg.seat;
      roomCode = msg.code;
      youName = msg.name;
      errorMsg = null;
      peerPresent = msg.peerPresent;
      if (msg.peerPresent) enterDuel();
      else {
        screen = "waiting";
        render();
      }
      break;
    case "peer_joined":
      foeName = msg.name;
      peerPresent = true;
      enterDuel();
      break;
    case "peer_left":
      teardownDuel();
      screen = "ended";
      render();
      break;
    case "state":
      a = msg.a;
      b = msg.b;
      if (screen === "duel") updateGameScreen();
      break;
    case "match_state":
      if (msg.phase === "ended") {
        winner = msg.winner ?? null;
        teardownDuel();
        screen = "ended";
        render();
      }
      break;
    case "signal":
      handleSignal(msg.payload);
      break;
    case "error":
      if (screen === "lobby" || screen === "waiting") {
        goLobby(msg.message);
      } else {
        errorMsg = msg.message;
      }
      break;
  }
}

function handleSignal(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const data = payload as SignalPayload;
  if (data.kind === "offer") handleRemoteOffer(data.sdp).catch(console.error);
  else if (data.kind === "answer") peerConnection?.setRemoteDescription(data.sdp).catch(console.error);
  else if (data.kind === "ice") handleRemoteIce(data.candidate).catch(console.error);
}

function render() {
  if (screen === "lobby") renderLobby();
  else if (screen === "waiting") renderWaiting();
  else if (screen === "ended") renderEnded();
  else renderGameScreen();
}

function renderLobby() {
  app.innerHTML = `
    <h1>忍 JUTSUVERSE</h1>
    <p class="lede">
      Real-time 1v1. Sequences are moves —
      <kbd>TIGER SNAKE RAM</kbd> tiger,
      <kbd>BOAR SNAKE</kbd> guard.
      Create a room, share the code.
    </p>
    <div class="card">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" value="${escapeAttr(youName)}" maxlength="24" placeholder="Ronin" autocomplete="off" />
      </div>
      <div class="field">
        <label for="code">Room code</label>
        <input id="code" value="" maxlength="8" placeholder="leave blank to create" autocomplete="off" spellcheck="false" />
      </div>
      ${errorMsg ? `<div class="status" style="color:#ff5470">${escapeHtml(errorMsg)}</div>` : ""}
      <button class="connect-btn" id="go">Create duel</button>
    </div>
  `;

  const nameEl = document.querySelector<HTMLInputElement>("#name")!;
  const codeEl = document.querySelector<HTMLInputElement>("#code")!;
  const go = document.querySelector<HTMLButtonElement>("#go")!;

  const syncLabel = () => {
    go.textContent = codeEl.value.trim() ? "Join duel" : "Create duel";
  };
  codeEl.addEventListener("input", () => {
    codeEl.value = codeEl.value.toUpperCase();
    syncLabel();
  });
  go.addEventListener("click", () => {
    const name = nameEl.value.trim() || "Ronin";
    youName = name;
    const code = codeEl.value.trim().toUpperCase();
    if (code) socket.send({ type: "join", name, code });
    else socket.send({ type: "join", name });
  });
}

function renderWaiting() {
  app.innerHTML = `
    <h1>忍 JUTSUVERSE</h1>
    <p class="lede">Share this code. The duel starts when the second player joins.</p>
    <div class="card code-panel">
      <div class="code">${escapeHtml(roomCode)}</div>
      <button class="reset-btn" id="copy">Copy</button>
    </div>
    <div class="actions-row">
      <button class="reset-btn" id="leave">Cancel</button>
    </div>
  `;
  document.querySelector<HTMLButtonElement>("#copy")!.addEventListener("click", () => {
    void navigator.clipboard.writeText(roomCode);
  });
  document.querySelector<HTMLButtonElement>("#leave")!.addEventListener("click", () => {
    socket.send({ type: "leave" });
    goLobby();
  });
}

function renderEnded() {
  const youWon = winner === seat;
  const draw = winner === "draw";
  const title = draw ? "DRAW" : youWon ? "YOU WIN!" : "YOU LOSE";
  const kind = draw ? "" : youWon ? "win" : "lose";
  app.innerHTML = `
    <h1>忍 JUTSUVERSE</h1>
    <div class="banner ${kind}">${title}</div>
    <p class="lede">Room ${escapeHtml(roomCode || "—")}</p>
    <button class="connect-btn" id="again">Back to lobby</button>
  `;
  document.querySelector<HTMLButtonElement>("#again")!.addEventListener("click", () => {
    socket.send({ type: "leave" });
    goLobby();
  });
}

function renderGameScreen() {
  bindKeys();
  startKeepalive();
  signButtons = {};

  app.innerHTML = `
    <h1>忍 JUTSUVERSE</h1>
    <div class="status">Room <strong>${escapeHtml(roomCode)}</strong> · you are seat ${seat}</div>
    <div id="banner"></div>
    <p class="hint" id="hints"></p>
    <div class="panels">
      <div class="panel" id="panel-me"></div>
      <div class="panel" id="panel-opp"></div>
    </div>
    <div class="camera-row">
      <div class="camera-box">
        <video id="cam-video" autoplay playsinline muted></video>
        <canvas id="cam-canvas" width="960" height="540"></canvas>
        <div class="cam-sign" id="cam-sign">—</div>
        <div class="cam-label">You</div>
      </div>
      <div class="camera-box">
        <video id="remote-video" autoplay playsinline></video>
        <div class="cam-label">Opponent</div>
      </div>
    </div>
    <div class="actions-row">
      <button class="cam-btn" id="cam-toggle">Enable camera</button>
    </div>
    <div class="signs" id="signs"></div>
    <div class="actions-row">
      <button class="reset-btn" id="leave">Leave</button>
    </div>
    <div class="status">Hold seals in sequence · keys A S W D F G</div>
  `;

  const hints = document.querySelector<HTMLParagraphElement>("#hints")!;
  hints.innerHTML = MOVE_HINTS.map(
    (m) => `<span class="hint-move"><kbd>${m.seq}</kbd> ${m.name}</span>`,
  ).join("");

  const signsEl = document.querySelector<HTMLDivElement>("#signs")!;
  for (const def of SIGN_DEFS) {
    const btn = document.createElement("button");
    btn.className = "sign-btn";
    btn.textContent = `${def.label} (${def.key})`;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!held.has(def.sign)) emit(def.sign, "down");
    });
    btn.addEventListener("pointerup", () => {
      if (held.has(def.sign)) emit(def.sign, "up");
    });
    btn.addEventListener("pointerleave", () => {
      if (held.has(def.sign)) emit(def.sign, "up");
    });
    btn.addEventListener("pointercancel", () => {
      if (held.has(def.sign)) emit(def.sign, "up");
    });
    signsEl.appendChild(btn);
    signButtons[def.sign] = btn;
  }

  document.querySelector<HTMLButtonElement>("#leave")!.addEventListener("click", () => {
    socket.send({ type: "leave" });
    goLobby();
  });
  document.querySelector<HTMLButtonElement>("#cam-toggle")!.addEventListener("click", (e) => {
    toggleCamera(e.currentTarget as HTMLButtonElement);
  });

  updateGameScreen();
  trySetupWebRTC().catch(console.error);
}

function panelHtml(label: string, name: string, p: FighterPublic) {
  const hpPct = Math.max(0, (p.hp / MAX_HP) * 100);
  const buffer = p.buffer.length ? p.buffer.join(" · ") : "—";
  const move = p.moveId ? p.moveId : "—";
  const guard = p.guardLeft > 0 ? ` · guard ${p.guardLeft}` : "";
  return `
    <h3><span>${label}</span><span>${escapeHtml(name)}</span></h3>
    <div class="bar-label">HP ${p.hp}/${MAX_HP}</div>
    <div class="bar"><div class="bar-fill hp" style="width:${hpPct}%"></div></div>
    <div class="meta-line">Stance: ${p.stance}${guard}</div>
    <div class="meta-line">Move: ${move}</div>
    <div class="meta-line">Buffer: ${buffer}</div>
  `;
}

function updateGameScreen() {
  const me = seat === "a" ? a : b;
  const opp = seat === "a" ? b : a;
  const panelMe = document.querySelector<HTMLDivElement>("#panel-me");
  const panelOpp = document.querySelector<HTMLDivElement>("#panel-opp");
  if (!panelMe || !panelOpp) return;

  panelMe.innerHTML = panelHtml("You", youName, me);
  panelMe.classList.toggle("dead", me.hp <= 0);
  panelOpp.innerHTML = panelHtml("Opponent", foeName, opp);
  panelOpp.classList.toggle("dead", opp.hp <= 0);

  const banner = document.querySelector<HTMLDivElement>("#banner");
  if (banner) banner.innerHTML = "";
}

function createPeerConnection(): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      const payload: SignalPayload = { kind: "ice", candidate: e.candidate.toJSON() };
      socket.send({ type: "signal", payload });
    }
  };
  pc.ontrack = (e) => {
    const remoteVideo = document.querySelector<HTMLVideoElement>("#remote-video");
    if (remoteVideo) remoteVideo.srcObject = e.streams[0];
  };
  peerConnection = pc;
  return pc;
}

async function flushPendingIce(pc: RTCPeerConnection) {
  const queued = pendingIce;
  pendingIce = [];
  for (const candidate of queued) await pc.addIceCandidate(candidate);
}

async function trySetupWebRTC() {
  if (!localStream || !peerPresent || peerConnection) return;
  const pc = createPeerConnection();
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream!));

  if (pendingOffer) {
    const offer = pendingOffer;
    pendingOffer = null;
    await pc.setRemoteDescription(offer);
    await flushPendingIce(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.send({ type: "signal", payload: { kind: "answer", sdp: pc.localDescription! } satisfies SignalPayload });
  } else if (seat === "a") {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send({ type: "signal", payload: { kind: "offer", sdp: pc.localDescription! } satisfies SignalPayload });
  }
}

async function handleRemoteOffer(sdp: RTCSessionDescriptionInit) {
  if (!peerConnection) {
    pendingOffer = sdp;
    return;
  }
  await peerConnection.setRemoteDescription(sdp);
  await flushPendingIce(peerConnection);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.send({ type: "signal", payload: { kind: "answer", sdp: peerConnection.localDescription! } satisfies SignalPayload });
}

async function handleRemoteIce(candidate: RTCIceCandidateInit) {
  if (peerConnection && peerConnection.remoteDescription) {
    await peerConnection.addIceCandidate(candidate);
  } else {
    pendingIce.push(candidate);
  }
}

function resetWebRTC() {
  peerConnection?.close();
  peerConnection = null;
  pendingOffer = null;
  pendingIce = [];
  const remoteVideo = document.querySelector<HTMLVideoElement>("#remote-video");
  if (remoteVideo) remoteVideo.srcObject = null;
}

function shutdownCamera() {
  if (!cameraOn && !localStream) return;
  const video = document.querySelector<HTMLVideoElement>("#cam-video");
  const canvas = document.querySelector<HTMLCanvasElement>("#cam-canvas");
  if (cameraLoopId !== null) cancelAnimationFrame(cameraLoopId);
  cameraLoopId = null;
  if (video) stopCamera(video);
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  if (camHeld) emit(camHeld, "up");
  localStream = null;
  camHeld = null;
  camCandidate = null;
  camCandidateCount = 0;
  cameraOn = false;
}

async function toggleCamera(toggleBtn: HTMLButtonElement) {
  const video = document.querySelector<HTMLVideoElement>("#cam-video");
  const canvas = document.querySelector<HTMLCanvasElement>("#cam-canvas");
  if (!video || !canvas) return;

  if (cameraOn) {
    shutdownCamera();
    resetWebRTC();
    toggleBtn.textContent = "Enable camera";
    toggleBtn.classList.remove("active");
    return;
  }

  try {
    toggleBtn.textContent = "Starting…";
    toggleBtn.disabled = true;
    await initHandSignDetector();
    localStream = await startCamera(video);
    cameraOn = true;
    toggleBtn.textContent = "Disable camera";
    toggleBtn.classList.add("active");
    runCameraLoop(video, canvas);
    trySetupWebRTC().catch(console.error);
  } catch (err) {
    console.error(err);
    toggleBtn.textContent = "Camera failed — retry";
    alert("Couldn't start hand-sign detection. Check camera permissions and the model asset, then try again.");
  } finally {
    toggleBtn.disabled = false;
  }
}

function runCameraLoop(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const signLabel = document.querySelector<HTMLDivElement>("#cam-sign");

  const step = async () => {
    if (!cameraOn) return;
    try {
      const { sign, detections, elapsedMs } = await detectFrame(video);
      if (!cameraOn) return;

      drawDetections(canvas, video, detections, elapsedMs);
      if (signLabel) {
        const topDetection = detections[0];
        signLabel.textContent = topDetection
          ? `${topDetection.label} ${(topDetection.score * 100).toFixed(1)}%`
          : "—";
      }

      const next = PLAYABLE.has(sign) ? (sign as Sign) : null;
      if (next === camCandidate) camCandidateCount += 1;
      else {
        camCandidate = next;
        camCandidateCount = 1;
      }

      if (camCandidateCount >= HYSTERESIS && camCandidate !== camHeld) {
        if (camHeld) emit(camHeld, "up");
        if (camCandidate) emit(camCandidate, "down");
        camHeld = camCandidate;
      }
    } catch (error) {
      console.error("Hand-sign inference failed", error);
      if (signLabel) signLabel.textContent = "Inference error";
      if (camHeld) {
        emit(camHeld, "up");
        camHeld = null;
      }
    }

    cameraLoopId = requestAnimationFrame(() => void step());
  };

  cameraLoopId = requestAnimationFrame(() => void step());
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}

socket.connect((msg) => handleServer(msg));
renderLobby();
