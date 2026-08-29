import "./style.css";
import {
  SIGNS,
  MEME_SIGNS,
  type ClientMessage,
  type MatchPublic,
  type MemeMatchPublic,
  type PlayerPublic,
  type ServerMessage,
} from "./types";
import { initSignDetector, startCamera, stopCamera, detectFrame, drawDetection } from "./signDetector";

const SEND_INTERVAL_MS = 150;
const VALID_SIGNS = new Set(SIGNS.map((s) => s.sign)); // TIGER/SNAKE/BIRD/RAM/BOAR
const VALID_MEME_LABELS = new Set(MEME_SIGNS.map((m) => m.label));

const app = document.querySelector<HTMLDivElement>("#app")!;

type Mode = "duel" | "meme";
// mode + room come from the URL when present, so duplicating this tab (or
// sharing its link) to open a second player lands on the same mode + room
// instead of silently defaulting back to Ninja Duel / match1
const initialParams = new URLSearchParams(window.location.search);
let mode: Mode = initialParams.get("mode") === "meme" ? "meme" : "duel";
let defaultRoom = initialParams.get("room")?.trim() || "match1";

function syncUrl() {
  const params = new URLSearchParams(window.location.search);
  params.set("mode", mode);
  params.set("room", defaultRoom);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

let ws: WebSocket | null = null;
let myId = "";
let holdTimer: number | null = null;

// ── camera-driven sign detection ────────────────────────────────
let cameraOn = false;
let activeCamSign = "UNKNOWN";
let signButtons: Record<string, HTMLButtonElement> = {};

// ── peer-to-peer video call (see opponent's webcam) ───────────────
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let opponentId: string | null = null;
let isInitiator = false;
let pendingOffer: RTCSessionDescriptionInit | null = null;
let pendingIce: RTCIceCandidateInit[] = [];

// ── connect screen ──────────────────────────────────────────────
function renderConnectScreen(errorMsg?: string) {
  app.innerHTML = `
    <h1>忍 JUTSUVERSE</h1>
    <div class="mode-toggle">
      <button class="mode-btn${mode === "duel" ? " active" : ""}" id="mode-duel" type="button">Ninja Duel</button>
      <button class="mode-btn${mode === "meme" ? " active" : ""}" id="mode-meme" type="button">Meme Battle</button>
    </div>
    <div class="card">
      <div class="field">
        <label for="server">Server</label>
        <input id="server" value="ws://localhost:8000" />
      </div>
      <div class="field">
        <label for="room">Room</label>
        <input id="room" value="${defaultRoom}" />
      </div>
      <div class="field">
        <label for="player">Player ID</label>
        <input id="player" value="p1" />
      </div>
      <button class="connect-btn" id="connect">Connect</button>
      ${errorMsg ? `<div class="status" style="color:#ff5470">${errorMsg}</div>` : ""}
      <div class="status">Duplicate this tab's URL to open player 2 on the same mode + room.</div>
    </div>
  `;

  document.querySelector<HTMLInputElement>("#room")!.addEventListener("input", (e) => {
    defaultRoom = (e.target as HTMLInputElement).value.trim() || "match1";
    syncUrl();
  });

  document.querySelector<HTMLButtonElement>("#mode-duel")!.addEventListener("click", () => {
    mode = "duel";
    syncUrl();
    renderConnectScreen();
  });
  document.querySelector<HTMLButtonElement>("#mode-meme")!.addEventListener("click", () => {
    mode = "meme";
    syncUrl();
    renderConnectScreen();
  });

  document.querySelector<HTMLButtonElement>("#connect")!.addEventListener("click", () => {
    const server = document.querySelector<HTMLInputElement>("#server")!.value.trim();
    const room = document.querySelector<HTMLInputElement>("#room")!.value.trim();
    const player = document.querySelector<HTMLInputElement>("#player")!.value.trim();
    if (!server || !room || !player) return;
    connect(server, room, player);
  });

  syncUrl();
}

// ── websocket ────────────────────────────────────────────────────
function connect(server: string, room: string, player: string) {
  myId = player;
  const path = mode === "duel" ? `/ws/${room}/${player}` : `/ws/meme/${room}/${player}`;
  const socket = new WebSocket(`${server}${path}`);

  socket.addEventListener("open", () => {
    ws = socket;
    if (mode === "duel") {
      renderGameScreen();
    } else {
      renderMemeScreen();
    }
  });

  socket.addEventListener("message", (event) => {
    const msg: ServerMessage = JSON.parse(event.data);
    if (msg.type === "state") {
      updateGameScreen(msg.match);
    } else if (msg.type === "meme_state") {
      updateMemeScreen(msg.match);
    } else if (msg.type === "error") {
      socket.close();
      renderConnectScreen(msg.message);
    } else if (msg.type === "webrtc-peer") {
      opponentId = msg.peer_id;
      isInitiator = msg.initiator;
      trySetupWebRTC().catch(console.error);
    } else if (msg.type === "webrtc-offer") {
      handleRemoteOffer(msg.sdp).catch(console.error);
    } else if (msg.type === "webrtc-answer") {
      peerConnection?.setRemoteDescription(msg.sdp).catch(console.error);
    } else if (msg.type === "webrtc-ice") {
      handleRemoteIce(msg.candidate).catch(console.error);
    }
  });

  socket.addEventListener("close", () => {
    if (ws === socket) {
      ws = null;
      stopHolding();
      shutdownCamera();
      resetWebRTC();
      renderConnectScreen("Disconnected from server");
    }
  });

  socket.addEventListener("error", () => {
    renderConnectScreen("Could not reach server");
  });
}

function send(msg: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── hold-to-cast ─────────────────────────────────────────────────
function startHolding(sign: string, btn?: HTMLButtonElement) {
  stopHolding();
  (btn ?? signButtons[sign])?.classList.add("holding");
  send({ type: "sign", sign });
  holdTimer = window.setInterval(() => send({ type: "sign", sign }), SEND_INTERVAL_MS);
}

function stopHolding() {
  if (holdTimer !== null) {
    window.clearInterval(holdTimer);
    holdTimer = null;
  }
  document.querySelectorAll(".sign-btn.holding").forEach((el) => el.classList.remove("holding"));
  if (mode === "duel") send({ type: "sign", sign: "UNKNOWN" });
}

function sendMemeLabel(label: string) {
  send({ type: "meme", label });
}

// ── shared camera UI (used by both the duel and meme screens) ────
function cameraRowHtml(): string {
  return `
    <div class="camera-row">
      <div class="camera-box">
        <video id="cam-video" autoplay playsinline muted></video>
        <canvas id="cam-canvas" width="480" height="360"></canvas>
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
  `;
}

function wireCameraToggle() {
  document.querySelector<HTMLButtonElement>("#cam-toggle")!.addEventListener("click", (e) => {
    toggleCamera(e.currentTarget as HTMLButtonElement);
  });
}

// ── game screen ──────────────────────────────────────────────────
function renderGameScreen() {
  app.innerHTML = `
    <h1>忍 JUTSUVERSE</h1>
    <div id="banner"></div>
    <div class="panels">
      <div class="panel" id="panel-me"></div>
      <div class="panel" id="panel-opp"></div>
    </div>
    ${cameraRowHtml()}
    <div class="signs" id="signs"></div>
    <div class="log" id="log"></div>
    <div class="actions-row">
      <button class="reset-btn" id="reset">Reset match</button>
    </div>
    <div class="status">Connected as <strong>${myId}</strong> — hold a sign for ~1s to cast it</div>
  `;

  signButtons = {};
  const signsEl = document.querySelector<HTMLDivElement>("#signs")!;
  for (const def of SIGNS) {
    const btn = document.createElement("button");
    btn.className = "sign-btn";
    btn.dataset.kind = def.kind;
    btn.textContent = def.label;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startHolding(def.sign, btn);
    });
    btn.addEventListener("pointerup", stopHolding);
    btn.addEventListener("pointerleave", stopHolding);
    btn.addEventListener("pointercancel", stopHolding);
    signsEl.appendChild(btn);
    signButtons[def.sign] = btn;
  }

  document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
    send({ type: "reset" });
  });

  wireCameraToggle();
}

// ── meme battle screen ────────────────────────────────────────────
function renderMemeScreen() {
  app.innerHTML = `
    <h1>忍 JUTSUVERSE</h1>
    <div id="banner"></div>
    <div class="meme-round-info">
      <div class="meme-target" id="meme-target">Waiting for opponent…</div>
    </div>
    ${cameraRowHtml()}
    <div class="actions-row" id="meme-trigger-row"></div>
    <div class="actions-row">
      <button class="reset-btn" id="reset">New round</button>
    </div>
    <div class="status">Connected as <strong>${myId}</strong> — whoever performs the target gesture first wins</div>
  `;

  document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
    send({ type: "reset" });
  });

  wireCameraToggle();
}

// ── peer-to-peer video call ───────────────────────────────────────
function createPeerConnection(): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => {
    if (e.candidate) send({ type: "webrtc-ice", candidate: e.candidate.toJSON() });
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
  for (const candidate of queued) {
    await pc.addIceCandidate(candidate);
  }
}

// called once we know the opponent's id AND our own camera is on —
// whichever happens second triggers the handshake
async function trySetupWebRTC() {
  if (!localStream || opponentId === null || peerConnection) return;
  const pc = createPeerConnection();
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream!));

  if (pendingOffer) {
    const offer = pendingOffer;
    pendingOffer = null;
    await pc.setRemoteDescription(offer);
    await flushPendingIce(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: "webrtc-answer", sdp: pc.localDescription! });
  } else if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "webrtc-offer", sdp: pc.localDescription! });
  }
}

async function handleRemoteOffer(sdp: RTCSessionDescriptionInit) {
  if (!peerConnection) {
    // opponent's camera came on before ours — remember the offer and
    // answer it once we enable our own camera
    pendingOffer = sdp;
    return;
  }
  await peerConnection.setRemoteDescription(sdp);
  await flushPendingIce(peerConnection);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  send({ type: "webrtc-answer", sdp: peerConnection.localDescription! });
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
  opponentId = null;
  isInitiator = false;
  pendingOffer = null;
  pendingIce = [];
  const remoteVideo = document.querySelector<HTMLVideoElement>("#remote-video");
  if (remoteVideo) remoteVideo.srcObject = null;
}

// ── camera toggle + detection loop ──────────────────────────────
function shutdownCamera() {
  if (!cameraOn) return;
  const video = document.querySelector<HTMLVideoElement>("#cam-video");
  cameraOn = false;
  if (video) stopCamera(video);
  localStream = null;
  activeCamSign = "UNKNOWN";
}

async function toggleCamera(toggleBtn: HTMLButtonElement) {
  const video = document.querySelector<HTMLVideoElement>("#cam-video");
  const canvas = document.querySelector<HTMLCanvasElement>("#cam-canvas");
  if (!video || !canvas) return;

  if (cameraOn) {
    cameraOn = false;
    stopCamera(video);
    stopHolding();
    resetWebRTC();
    localStream = null;
    activeCamSign = "UNKNOWN";
    toggleBtn.textContent = "Enable camera";
    toggleBtn.classList.remove("active");
    return;
  }

  try {
    toggleBtn.textContent = "Starting…";
    toggleBtn.disabled = true;
    await initSignDetector();
    localStream = await startCamera(video);
    cameraOn = true;
    toggleBtn.textContent = "Disable camera";
    toggleBtn.classList.add("active");
    runCameraLoop(video, canvas);
    trySetupWebRTC().catch(console.error);
  } catch (err) {
    console.error(err);
    toggleBtn.textContent = "Camera failed — retry";
    alert("Couldn't access the camera. Check browser permissions and try again.");
  } finally {
    toggleBtn.disabled = false;
  }
}

function runCameraLoop(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const signLabel = document.querySelector<HTMLDivElement>("#cam-sign");

  const step = async () => {
    if (!cameraOn) return;
    const { sign, box, score } = await detectFrame(video);
    if (!cameraOn) return; // camera may have been disabled while awaiting inference

    drawDetection(canvas, video, box, sign === "UNKNOWN" ? "" : `${sign} ${(score * 100).toFixed(0)}%`);
    if (signLabel) signLabel.textContent = sign === "UNKNOWN" ? "—" : sign;

    if (sign !== activeCamSign) {
      activeCamSign = sign;
      if (mode === "duel") {
        if (VALID_SIGNS.has(sign)) {
          startHolding(sign);
        } else {
          stopHolding();
        }
      } else {
        sendMemeLabel(VALID_MEME_LABELS.has(sign) ? sign : "UNKNOWN");
      }
    }

    requestAnimationFrame(() => void step());
  };

  step();
}

function panelHtml(label: string, p: PlayerPublic) {
  return `
    <h3><span>${label}</span><span>${p.player_id}</span></h3>
    <div class="bar-label">HP ${p.hp.toFixed(0)}</div>
    <div class="bar"><div class="bar-fill hp" style="width:${Math.max(0, p.hp)}%"></div></div>
    <div class="bar-label">Energy ${p.energy.toFixed(0)}</div>
    <div class="bar"><div class="bar-fill energy" style="width:${Math.max(0, p.energy)}%"></div></div>
    <div class="meta-line">Sign: ${p.current_sign}${p.active_effect ? ` · ${p.active_effect} armed` : ""}</div>
    <div class="meta-line">Reflect x${p.reflect_uses_left} · Protect x${p.protect_uses_left}</div>
  `;
}

function updateGameScreen(match: MatchPublic) {
  const me = match.p1.player_id === myId ? match.p1 : match.p2;
  const opp = match.p1.player_id === myId ? match.p2 : match.p1;

  const panelMe = document.querySelector<HTMLDivElement>("#panel-me");
  const panelOpp = document.querySelector<HTMLDivElement>("#panel-opp");
  if (!panelMe || !panelOpp) return; // screen not mounted yet

  panelMe.innerHTML = panelHtml("You", me);
  panelMe.classList.toggle("dead", !me.alive);
  panelOpp.innerHTML = panelHtml("Opponent", opp);
  panelOpp.classList.toggle("dead", !opp.alive);

  const banner = document.querySelector<HTMLDivElement>("#banner")!;
  if (match.winner) {
    const won = match.winner === myId;
    banner.innerHTML = `<div class="banner ${won ? "win" : "lose"}">${won ? "YOU WIN!" : "YOU LOSE"}</div>`;
  } else {
    banner.innerHTML = "";
  }

  const log = document.querySelector<HTMLDivElement>("#log")!;
  log.innerHTML = match.log.map((line) => `<div>${line}</div>`).join("");
  log.scrollTop = log.scrollHeight;
}

function updateMemeScreen(match: MemeMatchPublic) {
  const targetDisplay = MEME_SIGNS.find((m) => m.label === match.target)?.display ?? match.target;

  document.querySelector<HTMLDivElement>("#meme-target")!.textContent = match.winner
    ? `Target was: ${targetDisplay}`
    : `Target: ${targetDisplay}`;

  // (re)build the manual trigger button whenever the round's target changes
  // (a click is one attempt at the target -- the server decides if it wins)
  const triggerRow = document.querySelector<HTMLDivElement>("#meme-trigger-row")!;
  if (triggerRow.dataset.forTarget !== match.target) {
    triggerRow.dataset.forTarget = match.target;
    triggerRow.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "sign-btn";
    btn.textContent = `Do ${targetDisplay}`;
    btn.addEventListener("click", () => send({ type: "meme", label: match.target }));
    triggerRow.appendChild(btn);
  }

  const banner = document.querySelector<HTMLDivElement>("#banner")!;
  if (match.winner) {
    const won = match.winner === myId;
    const time = match.win_time_seconds !== null ? ` (${match.win_time_seconds.toFixed(2)}s)` : "";
    const text = `${won ? "YOU WIN!" : "YOU LOSE"}${time}`;
    banner.innerHTML = `<div class="banner ${won ? "win" : "lose"}">${text}</div>`;
  } else {
    banner.innerHTML = "";
  }
}

renderConnectScreen();