import "./style.css";
import { SIGNS, type ClientMessage, type MatchPublic, type PlayerPublic, type ServerMessage } from "./types";

const SEND_INTERVAL_MS = 150;

const app = document.querySelector<HTMLDivElement>("#app")!;

let ws: WebSocket | null = null;
let myId = "";
let holdTimer: number | null = null;

// ── connect screen ──────────────────────────────────────────────
function renderConnectScreen(errorMsg?: string) {
  app.innerHTML = `
    <h1>忍 JUTSUVERSE</h1>
    <div class="card">
      <div class="field">
        <label for="server">Server</label>
        <input id="server" value="ws://localhost:8000" />
      </div>
      <div class="field">
        <label for="room">Room</label>
        <input id="room" value="match1" />
      </div>
      <div class="field">
        <label for="player">Player ID</label>
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
  myId = player;
  const socket = new WebSocket(`${server}/ws/${room}/${player}`);

  socket.addEventListener("open", () => {
    ws = socket;
    renderGameScreen();
  });

  socket.addEventListener("message", (event) => {
    const msg: ServerMessage = JSON.parse(event.data);
    if (msg.type === "state") {
      updateGameScreen(msg.match);
    } else if (msg.type === "error") {
      socket.close();
      renderConnectScreen(msg.message);
    }
  });

  socket.addEventListener("close", () => {
    if (ws === socket) {
      ws = null;
      stopHolding();
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
function startHolding(sign: string, btn: HTMLButtonElement) {
  stopHolding();
  btn.classList.add("holding");
  send({ type: "sign", sign });
  holdTimer = window.setInterval(() => send({ type: "sign", sign }), SEND_INTERVAL_MS);
}

function stopHolding() {
  if (holdTimer !== null) {
    window.clearInterval(holdTimer);
    holdTimer = null;
  }
  document.querySelectorAll(".sign-btn.holding").forEach((el) => el.classList.remove("holding"));
  send({ type: "sign", sign: "UNKNOWN" });
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
    <div class="signs" id="signs"></div>
    <div class="log" id="log"></div>
    <div class="actions-row">
      <button class="reset-btn" id="reset">Reset match</button>
    </div>
    <div class="status">Connected as <strong>${myId}</strong> — hold a sign for ~1s to cast it</div>
  `;

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
  }

  document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
    send({ type: "reset" });
  });
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

renderConnectScreen();
