import "./style.css";
import { MAX_HP, TICK_HZ, type FighterPublic, type Seat, type ServerMsg, type Sign } from "@jutsu/protocol";
import { initHandSignDetector, startCamera, stopCamera, detectFrame, drawDetections } from "./handTracker";
import { GameSocket } from "./net/gameSocket";
import { isWebRtcSignal, SIGNS, type WebRtcSignal } from "./types";

const VALID_SIGNS = new Set<Sign>(SIGNS.map((s) => s.sign));

const app = document.querySelector<HTMLDivElement>("#app")!;

let gameSocket: GameSocket | null = null;
let myName = "";
let mySeat: Seat | null = null;
let opponentName = "Opponent";
let roomCode = "";
let heldSign: Sign | null = null;
let matchPhase: "waiting" | "connecting" | "live" | "ended" = "waiting";
let matchWinner: Seat | "draw" | null = null;
let disconnectMessage = "Disconnected from server";
let previousMoveIds: Record<Seat, string | null> = { a: null, b: null };
const gameLog: string[] = [];

// ── camera-driven sign detection ────────────────────────────────
let cameraOn = false;
let cameraLoopId: number | null = null;
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
    <div class="card">
      <div class="field">
        <label for="server">Server</label>
        <input id="server" value="ws://localhost:8080" />
      </div>
      <div class="field">
        <label for="room">Room</label>
        <input id="room" value="match1" />
      </div>
      <div class="field">
        <label for="player">Player Name</label>
        <input id="player" value="p1" />
      </div>
      <button class="connect-btn" id="connect">Connect</button>
      ${errorMsg ? `<div class="status" style="color:#ff5470">${errorMsg}</div>` : ""}
    </div>
  `;

  document.querySelector<HTMLButtonElement>("#connect")!.addEventListener("click", () => {
    const server = document.querySelector<HTMLInputElement>("#server")!.value.trim();
    const room = document.querySelector<HTMLInputElement>("#room")!.value.trim();
    const player = document.querySelector<HTMLInputElement>("#player")!.value.trim();
    if (!server || !room || !player) return;
    connect(server, room, player);
  });
}

// ── websocket ────────────────────────────────────────────────────
function connect(server: string, room: string, player: string) {
  myName = player;
  mySeat = null;
  opponentName = "Opponent";
  opponentId = null;
  roomCode = room.toUpperCase();
  disconnectMessage = "Disconnected from server";

  const socket = new GameSocket({
    onMessage: handleServerMessage,
    onClose: () => {
      if (gameSocket !== socket) return;
      gameSocket = null;
      heldSign = null;
      shutdownCamera();
      resetWebRTC();
      renderConnectScreen(disconnectMessage);
    },
    onError: () => {
      disconnectMessage = "Could not reach server";
    },
  });
  gameSocket = socket;
  try {
    socket.connect(server, roomCode, player);
  } catch {
    gameSocket = null;
    renderConnectScreen("Invalid server address");
  }
}

function handleServerMessage(msg: ServerMsg) {
  if (msg.type === "joined") {
    myName = msg.name;
    mySeat = msg.seat;
    roomCode = msg.code;
    matchPhase = "waiting";
    matchWinner = null;
    gameLog.length = 0;
    addLog(`Joined room ${roomCode} as ${myName}`);
    renderGameScreen();
    gameSocket?.sendReady();
    if (msg.peerPresent) configurePeer(msg.seat === "a" ? "b" : "a");
    return;
  }

  if (msg.type === "peer_joined") {
    opponentName = msg.name;
    configurePeer(msg.seat);
    addLog(`${msg.name} joined the room`);
    gameSocket?.sendReady();
    updateConnectionStatus();
    return;
  }

  if (msg.type === "peer_left") {
    addLog(`${opponentName} left the room`);
    opponentName = "Opponent";
    opponentId = null;
    resetWebRTC();
    updateConnectionStatus();
    return;
  }

  if (msg.type === "state") {
    updateGameScreen(msg.a, msg.b);
    return;
  }

  if (msg.type === "match_state") {
    if (msg.phase !== matchPhase) addLog(`Match is ${msg.phase}`);
    matchPhase = msg.phase;
    matchWinner = msg.winner ?? null;
    updateBanner();
    updateConnectionStatus();
    return;
  }

  if (msg.type === "signal" && isWebRtcSignal(msg.payload)) {
    handleWebRtcSignal(msg.payload);
    return;
  }

  if (msg.type === "error") {
    disconnectMessage = msg.message;
    gameSocket?.close();
  }
}

function configurePeer(seat: Seat) {
  opponentId = seat;
  isInitiator = mySeat === "a";
  trySetupWebRTC().catch(console.error);
}

function handleWebRtcSignal(signal: WebRtcSignal) {
  if (signal.kind === "webrtc-offer") {
    handleRemoteOffer(signal.sdp).catch(console.error);
  } else if (signal.kind === "webrtc-answer") {
    peerConnection?.setRemoteDescription(signal.sdp).catch(console.error);
  } else {
    handleRemoteIce(signal.candidate).catch(console.error);
  }
}

// ── sign input ───────────────────────────────────────────────────
function startHolding(sign: Sign, btn?: HTMLButtonElement) {
  if (heldSign === sign) return;
  stopHolding();
  heldSign = sign;
  (btn ?? signButtons[sign])?.classList.add("holding");
  gameSocket?.sendInput(sign, "down");
}

function stopHolding() {
  if (heldSign) gameSocket?.sendInput(heldSign, "up");
  heldSign = null;
  document.querySelectorAll(".sign-btn.holding").forEach((el) => el.classList.remove("holding"));
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
    <div class="log" id="log"></div>
    <div class="actions-row">
      <button class="reset-btn" id="reset">Reset match</button>
    </div>
    <div class="status" id="connection-status"></div>
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
    previousMoveIds = { a: null, b: null };
    matchWinner = null;
    addLog("Match reset");
    updateBanner();
    gameSocket?.resetMatch();
  });

  document.querySelector<HTMLButtonElement>("#cam-toggle")!.addEventListener("click", (e) => {
    toggleCamera(e.currentTarget as HTMLButtonElement);
  });

  updateConnectionStatus();
  renderLog();
}

// ── peer-to-peer video call ───────────────────────────────────────
function createPeerConnection(): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      gameSocket?.sendSignal({ kind: "webrtc-ice", candidate: e.candidate.toJSON() } satisfies WebRtcSignal);
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
    gameSocket?.sendSignal({ kind: "webrtc-answer", sdp: pc.localDescription! } satisfies WebRtcSignal);
  } else if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    gameSocket?.sendSignal({ kind: "webrtc-offer", sdp: pc.localDescription! } satisfies WebRtcSignal);
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
  gameSocket?.sendSignal({ kind: "webrtc-answer", sdp: peerConnection.localDescription! } satisfies WebRtcSignal);
}

async function handleRemoteIce(candidate: RTCIceCandidateInit) {
  if (peerConnection && peerConnection.remoteDescription) {
    await peerConnection.addIceCandidate(candidate);
  } else {
    pendingIce.push(candidate);
  }
}

function resetWebRTC(clearPeer = true) {
  peerConnection?.close();
  peerConnection = null;
  if (clearPeer) opponentId = null;
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
  const canvas = document.querySelector<HTMLCanvasElement>("#cam-canvas");
  if (cameraLoopId !== null) cancelAnimationFrame(cameraLoopId);
  cameraLoopId = null;
  if (video) stopCamera(video);
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  localStream = null;
  activeCamSign = "UNKNOWN";
  cameraOn = false;
}

async function toggleCamera(toggleBtn: HTMLButtonElement) {
  const video = document.querySelector<HTMLVideoElement>("#cam-video");
  const canvas = document.querySelector<HTMLCanvasElement>("#cam-canvas");
  if (!video || !canvas) return;

  if (cameraOn) {
    if (cameraLoopId !== null) cancelAnimationFrame(cameraLoopId);
    cameraLoopId = null;
    stopCamera(video);
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    stopHolding();
    resetWebRTC(false);
    localStream = null;
    activeCamSign = "UNKNOWN";
    cameraOn = false;
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

      if (sign !== activeCamSign) {
        activeCamSign = sign;
        if (sign !== "UNKNOWN" && VALID_SIGNS.has(sign)) {
          startHolding(sign);
        } else {
          stopHolding();
        }
      }
    } catch (error) {
      console.error("Hand-sign inference failed", error);
      if (signLabel) signLabel.textContent = "Inference error";
      if (activeCamSign !== "UNKNOWN") {
        activeCamSign = "UNKNOWN";
        stopHolding();
      }
    }

    cameraLoopId = requestAnimationFrame(() => void step());
  };

  cameraLoopId = requestAnimationFrame(() => void step());
}

function panelHtml(label: string, playerName: string, fighter: FighterPublic) {
  const hpPercent = Math.max(0, Math.min(100, (fighter.hp / MAX_HP) * 100));
  const bufferPercent = Math.min(100, (fighter.buffer.length / 3) * 100);
  const buffer = fighter.buffer.length > 0 ? fighter.buffer.join(" → ") : "—";
  const held = fighter.held.length > 0 ? fighter.held.join(", ") : "—";
  const guardSeconds = fighter.guardLeft / TICK_HZ;

  return `
    <h3><span>${label}</span><span>${escapeHtml(playerName)}</span></h3>
    <div class="bar-label">HP ${fighter.hp} / ${MAX_HP}</div>
    <div class="bar"><div class="bar-fill hp" style="width:${hpPercent}%"></div></div>
    <div class="bar-label">Sequence ${fighter.buffer.length} / 3</div>
    <div class="bar"><div class="bar-fill energy" style="width:${bufferPercent}%"></div></div>
    <div class="meta-line">Stance: ${fighter.stance}${fighter.moveId ? ` · ${escapeHtml(fighter.moveId)}` : ""}</div>
    <div class="meta-line">Buffer: ${buffer} · Held: ${held}${guardSeconds > 0 ? ` · Guard ${guardSeconds.toFixed(1)}s` : ""}</div>
  `;
}

function updateGameScreen(a: FighterPublic, b: FighterPublic) {
  if (!mySeat) return;
  const me = mySeat === "a" ? a : b;
  const opponent = mySeat === "a" ? b : a;

  const panelMe = document.querySelector<HTMLDivElement>("#panel-me");
  const panelOpp = document.querySelector<HTMLDivElement>("#panel-opp");
  if (!panelMe || !panelOpp) return;

  panelMe.innerHTML = panelHtml("You", myName, me);
  panelMe.classList.toggle("dead", me.hp <= 0);
  panelOpp.innerHTML = panelHtml("Opponent", opponentName, opponent);
  panelOpp.classList.toggle("dead", opponent.hp <= 0);

  recordMove("a", a);
  recordMove("b", b);
  updateBanner();
}

function recordMove(seat: Seat, fighter: FighterPublic) {
  if (fighter.moveId && fighter.moveId !== previousMoveIds[seat]) {
    const label = seat === mySeat ? "You" : opponentName;
    addLog(`${label}: ${fighter.moveId}`);
  }
  previousMoveIds[seat] = fighter.moveId;
}

function updateBanner() {
  const banner = document.querySelector<HTMLDivElement>("#banner");
  if (!banner) return;
  if (matchPhase !== "ended" || !matchWinner) {
    banner.innerHTML = "";
    return;
  }

  if (matchWinner === "draw") {
    banner.innerHTML = '<div class="banner">DRAW</div>';
    return;
  }

  const won = matchWinner === mySeat;
  banner.innerHTML = `<div class="banner ${won ? "win" : "lose"}">${won ? "YOU WIN!" : "YOU LOSE"}</div>`;
}

function updateConnectionStatus() {
  const status = document.querySelector<HTMLDivElement>("#connection-status");
  if (!status) return;
  const peer = opponentId ? ` vs ${opponentName}` : " · waiting for opponent";
  status.textContent = `${myName} · Room ${roomCode} · ${matchPhase}${peer}`;
}

function addLog(message: string) {
  gameLog.push(message);
  if (gameLog.length > 30) gameLog.shift();
  renderLog();
}

function renderLog() {
  const log = document.querySelector<HTMLDivElement>("#log");
  if (!log) return;
  log.innerHTML = gameLog.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

renderConnectScreen();
