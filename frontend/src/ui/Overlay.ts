import { bus, Events } from "../core/EventBus";
import { session } from "../core/Session";
import { HAND_SIGNS, SEAL_IDS, signById, SKILLS, skillById, type Side } from "../types";
import { sealHtml, sealTextHtml } from "./sealVisual";

/**
 * The DOM layer above the Phaser canvas. Phaser can't host <input>/<video>/<img>,
 * so the connect form, camera-preview mount, on-screen seal pad, the seal HUD
 * (both players' in-progress sequences + skill flashes, as images with kanji
 * fallback) and the rolling log all live here. Scenes drive it via this API.
 */
class OverlayController {
  private app!: HTMLElement;
  private menu!: HTMLElement;
  private menuError!: HTMLElement;
  private lobby!: HTMLElement;
  private prep!: HTMLElement;
  private startGate!: HTMLElement;
  private camMount!: HTMLElement;
  private sealHud!: HTMLElement;
  private skillPanel!: HTMLElement;
  private skillCast!: HTMLElement;
  private skillTest!: HTMLElement;
  private sealNow!: HTMLElement;
  private skillCastTimer = 0;
  private debugEl!: HTMLElement;
  private sealGuide!: HTMLElement;
  private logEl!: HTMLElement;
  private rows: Record<Side, { seals: HTMLElement; live: HTMLElement; flash: HTMLElement }> = {} as never;

  mount(): void {
    this.app = document.querySelector<HTMLElement>("#app")!;
    this.app.innerHTML = `
      <div id="stage"></div>
      <div id="overlay">
        <form id="menu" autocomplete="off">
          <h1>忍 JUTSUVERSE</h1>
          <p class="tagline">Form the seals. The server referees.</p>
          <label>Your name <input name="player" value="${session.player}" maxlength="24" autocomplete="off" /></label>
          <button type="submit" data-act="create">Create room</button>
          <div class="menu-or">— or —</div>
          <label>Room code <input name="room" value="" placeholder="leave blank to create" maxlength="3" autocomplete="off" spellcheck="false" /></label>
          <button type="button" data-act="join">Join room</button>
          <div class="menu-error"></div>
          <div class="jutsu-key">${this.jutsuKeyHtml()}</div>
        </form>
        <div id="lobby" hidden>
          <h1>忍 JUTSUVERSE</h1>
          <p class="lobby-label">ROOM CODE</p>
          <p class="lobby-code">···</p>
          <p class="lobby-status">Creating room…</p>
          <button type="button" class="lobby-cancel">Cancel</button>
        </div>
        <div id="prep" hidden>
          <p class="prep-title">結印準備 · GET READY</p>
          <p class="prep-hint">Enable your camera — the round begins once <b>both</b> players are ready.</p>
          <p class="prep-status">…</p>
        </div>
        <div id="startgate" hidden>
          <p class="prep-title">試合開始 · READY?</p>
          <p class="prep-hint">Both cameras are on. Press <b>START</b> — the countdown begins once <b>both</b> players have pressed it.</p>
          <button type="button" class="startgate-btn">▶ START</button>
          <p class="startgate-status"></p>
        </div>
        <div id="cam-mount"></div>
        <div id="seal-hud" hidden>
          ${this.rowHtml("opp", "OPPONENT")}
          ${this.rowHtml("me", "YOU")}
        </div>
        <div id="skill-dock" hidden>
          <span class="dock-title">忍術<br>JUTSU</span>
          <div class="dock-row">${this.skillPanelHtml()}</div>
        </div>
        <div id="skill-cast" hidden></div>
        <div id="skill-test" hidden></div>
        <div id="seal-now" hidden>
          <span class="seal-now-label">DETECTED</span>
          <span class="seal-now-img"></span>
          <span class="seal-now-name">—</span>
        </div>
        <pre id="detect-debug" hidden></pre>
        <div id="battle-log" hidden></div>
        <div id="seal-guide" hidden>
          <div class="seal-guide-card">
            <h3>結印 SEAL GUIDE <button type="button" class="seal-guide-close">✕</button></h3>
            <div class="seal-guide-grid">${this.sealGuideHtml()}</div>
            <p class="seal-guide-note">Form these with your hands to the camera. Add photos at
              <code>public/assets/seals/&lt;id&gt;.png</code> — press <b>G</b> to toggle.</p>
          </div>
        </div>
      </div>
    `;

    this.menu = this.app.querySelector("#menu")!;
    this.menuError = this.app.querySelector(".menu-error")!;
    this.lobby = this.app.querySelector("#lobby")!;
    this.prep = this.app.querySelector("#prep")!;
    this.startGate = this.app.querySelector("#startgate")!;
    this.camMount = this.app.querySelector("#cam-mount")!;
    this.sealHud = this.app.querySelector("#seal-hud")!;
    this.skillPanel = this.app.querySelector("#skill-dock")!;
    this.skillCast = this.app.querySelector("#skill-cast")!;
    this.skillTest = this.app.querySelector("#skill-test")!;
    this.sealNow = this.app.querySelector("#seal-now")!;
    this.debugEl = this.app.querySelector("#detect-debug")!;
    this.sealGuide = this.app.querySelector("#seal-guide")!;
    this.logEl = this.app.querySelector("#battle-log")!;

    this.sealGuide.addEventListener("click", (e) => {
      if (e.target === this.sealGuide || (e.target as HTMLElement).closest(".seal-guide-close")) {
        this.hideSealGuide();
      }
    });

    for (const side of ["me", "opp"] as Side[]) {
      const row = this.sealHud.querySelector(`.seal-row[data-side="${side}"]`)!;
      this.rows[side] = {
        seals: row.querySelector(".seal-strip")!,
        live: row.querySelector(".seal-live")!,
        flash: row.querySelector(".seal-flash")!,
      };
    }

    const go = (room: string): void => {
      const data = new FormData(this.menu as HTMLFormElement);
      const opts = {
        room,
        player: String(data.get("player") ?? "").trim() || "Ronin",
      };
      Object.assign(session, opts);
      this.setMenuError("");
      bus.emit(Events.CONNECT_REQUEST, opts);
    };

    const roomInput = this.menu.querySelector<HTMLInputElement>('input[name="room"]')!;
    roomInput.addEventListener("input", () => {
      roomInput.value = roomInput.value.toUpperCase();
    });

    this.menu.addEventListener("submit", (e) => {
      e.preventDefault(); // "Create room" — no code, server allocates one
      go("");
    });
    this.menu.querySelector<HTMLButtonElement>('[data-act="join"]')!.addEventListener("click", () => {
      const code = roomInput.value.trim().toUpperCase();
      if (!code) {
        this.setMenuError("enter a room code to join");
        return;
      }
      go(code);
    });
    this.lobby.querySelector<HTMLButtonElement>(".lobby-cancel")!.addEventListener("click", () => {
      bus.emit(Events.RESET_REQUEST, "cancel");
    });
  }

  showLobby(code: string, peerPresent: boolean): void {
    this.menu.hidden = true;
    this.lobby.hidden = false;
    this.lobby.querySelector(".lobby-code")!.textContent = code || "···";
    this.setLobbyStatus(
      peerPresent ? "Opponent found — starting…" : "Waiting for opponent to join…",
    );
  }
  setLobbyStatus(text: string): void {
    this.lobby.querySelector(".lobby-status")!.textContent = text;
  }
  hideLobby(): void {
    this.lobby.hidden = true;
  }

  // ── pre-round camera check ──
  showPrep(): void {
    this.prep.hidden = false;
  }
  setPrepStatus(text: string): void {
    this.prep.querySelector(".prep-status")!.textContent = text;
  }
  hidePrep(): void {
    this.prep.hidden = true;
  }

  // ── start gate (both players press START, then the 3·2·1 runs) ──
  showStartGate(onStart: () => void): void {
    this.startGate.hidden = false;
    const btn = this.startGate.querySelector<HTMLButtonElement>(".startgate-btn")!;
    btn.disabled = false;
    btn.textContent = "▶ START";
    this.setStartStatus("");
    btn.onclick = () => {
      btn.disabled = true;
      btn.textContent = "READY";
      this.setStartStatus("Waiting for the other player to press START…");
      onStart();
    };
  }
  setStartStatus(text: string): void {
    this.startGate.querySelector(".startgate-status")!.textContent = text;
  }
  hideStartGate(): void {
    this.startGate.hidden = true;
  }

  private rowHtml(side: Side, label: string): string {
    return `<div class="seal-row" data-side="${side}">
      <span class="seal-row-label">${label}</span>
      <span class="seal-live"></span>
      <span class="seal-strip"></span>
      <span class="seal-flash"></span>
    </div>`;
  }

  private jutsuKeyHtml(): string {
    return SKILLS.map(
      (s) =>
        `<div><b>${s.nameJa}</b> <small>${s.name}</small><span>${s.seals
          .map((id) => signById(id)?.kanji ?? id)
          .join(" ")}</span></div>`,
    ).join("");
  }

  private sealGuideHtml(): string {
    return SEAL_IDS.map((id) => {
      const s = HAND_SIGNS.find((x) => x.id === id)!;
      return `<figure class="seal-guide-cell">
        ${sealHtml(id, "seal-cell--guide")}
        <figcaption>${s.en}<span>${s.kanji}</span></figcaption>
      </figure>`;
    }).join("");
  }

  private skillPanelHtml(): string {
    return SKILLS.map((s) => {
      const tag = s.action === "ATTACK" ? (s.element ?? "ATK") : s.action;
      return `<div class="skill-line" data-skill="${s.id}">
        <div class="skill-head">
          <span class="skill-name"><b>${s.nameJa}</b><small>${s.name}</small></span>
          <span class="skill-tag skill-tag--${s.action.toLowerCase()}">${tag}</span>
        </div>
        <div class="skill-seals">${s.seals.map((id) => sealHtml(id, "skill-seal")).join("")}</div>
      </div>`;
    }).join("");
  }

  get stageEl(): HTMLElement {
    return this.app.querySelector("#stage")!;
  }
  get cameraRoot(): HTMLElement {
    return this.camMount;
  }

  // ── menu ──
  showMenu(): void {
    this.menu.hidden = false;
    this.lobby.hidden = true;
    this.prep.hidden = true;
    this.startGate.hidden = true;
  }
  hideMenu(): void {
    this.menu.hidden = true;
  }
  setMenuError(msg: string): void {
    this.menuError.textContent = msg;
  }

  // ── seal HUD ──
  showSealHud(): void {
    this.sealHud.hidden = false;
    this.setSeals("me", []);
    this.setSeals("opp", []);
    this.setLiveSign("me", null);
    this.setLiveSign("opp", null);
  }
  hideSealHud(): void {
    this.sealHud.hidden = true;
  }

  setSeals(side: Side, ids: string[]): void {
    // both HUD strips are kanji-only; photos live in the Seal Guide (press G)
    this.rows[side].seals.innerHTML = ids.map((id) => sealTextHtml(id)).join("");
  }

  setLiveSign(side: Side, id: string | null): void {
    const known = id !== null && Boolean(signById(id));
    this.rows[side].live.innerHTML = known ? sealTextHtml(id, "seal-cell--live") : "";
  }

  /** a skill was cast → big centre banner with its image for 3 seconds */
  flashSkill(side: Side, skillId: string): void {
    const skill = skillById(skillId);
    if (!skill) return;
    const who = side === "me" ? "YOU" : "OPP";
    const art = skill.image
      ? `<img class="skill-cast-art" src="${import.meta.env.BASE_URL}${skill.image}" alt="${skill.name}">`
      : "";
    this.skillCast.innerHTML = `${art}<span class="skill-cast-who skill-cast-who--${side}">${who} CAST ${skill.name.toUpperCase()}</span>`;
    this.skillCast.hidden = false;
    // force reflow so the .on transition replays on rapid re-casts
    void this.skillCast.offsetWidth;
    this.skillCast.classList.add("on");
    window.clearTimeout(this.skillCastTimer);
    this.skillCastTimer = window.setTimeout(() => {
      this.skillCast.classList.remove("on");
      this.skillCast.hidden = true;
      this.skillCast.innerHTML = "";
    }, 2000);

    if (side === "me") {
      const row = this.skillPanel.querySelector(`.skill-line[data-skill="${skillId}"]`);
      row?.classList.add("fired");
      window.setTimeout(() => row?.classList.remove("fired"), 900);
    }
  }

  // ── TEMP: manual cast buttons in the middle (remove later) ──
  showSkillTest(onCast: (skillId: string) => void): void {
    this.skillTest.hidden = false;
    this.skillTest.innerHTML = `<span class="skill-test-label">TEST · cast</span>`;
    for (const s of SKILLS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "skill-test-btn";
      btn.innerHTML = `<b>${s.nameJa}</b><small>${s.name}</small>`;
      btn.addEventListener("click", () => onCast(s.id));
      this.skillTest.appendChild(btn);
    }
  }
  hideSkillTest(): void {
    this.skillTest.hidden = true;
    this.skillTest.innerHTML = "";
  }

  // ── skill panel (the jutsu list, always visible in battle) ──
  showSkillPanel(): void {
    this.skillPanel.hidden = false;
    this.highlightSkills([]);
  }
  hideSkillPanel(): void {
    this.skillPanel.hidden = true;
    window.clearTimeout(this.skillCastTimer);
    this.skillCast.hidden = true;
    this.skillCast.innerHTML = "";
  }

  /** light up how far the current seal buffer has progressed into each jutsu */
  highlightSkills(buffer: string[]): void {
    for (const line of this.skillPanel.querySelectorAll<HTMLElement>(".skill-line")) {
      const skill = skillById(line.dataset.skill ?? "");
      if (!skill) continue;
      let matched = 0;
      for (let k = Math.min(buffer.length, skill.seals.length); k > 0; k--) {
        if (eq(buffer.slice(-k), skill.seals.slice(0, k))) {
          matched = k;
          break;
        }
      }
      line.classList.toggle("armed", matched > 0);
      line.querySelectorAll(".skill-seal").forEach((m, i) => m.classList.toggle("hit", i < matched));
    }
  }

  // ── seal guide (how to form each seal; toggle with G) ──
  showSealGuide(): void {
    this.sealGuide.hidden = false;
  }
  hideSealGuide(): void {
    this.sealGuide.hidden = true;
  }
  toggleSealGuide(): void {
    this.sealGuide.hidden = !this.sealGuide.hidden;
  }

  // ── detector debug (toggle with D) ──
  setDebug(text: string | null): void {
    if (text === null) {
      this.debugEl.hidden = true;
      return;
    }
    this.debugEl.hidden = false;
    this.debugEl.textContent = text;
  }
  get debugVisible(): boolean {
    return !this.debugEl.hidden;
  }

  // ── big "currently detected" seal box — shows the existing seal PNG, enlarged ──
  showSealNow(): void {
    this.sealNow.hidden = false;
    this.setSealNow(null, 0);
  }
  hideSealNow(): void {
    this.sealNow.hidden = true;
  }
  setSealNow(id: string | null, score: number): void {
    const s = id ? signById(id) : undefined;
    this.sealNow.querySelector(".seal-now-img")!.innerHTML = s
      ? sealHtml(id!, "seal-cell--now")
      : `<span class="seal-cell seal-cell--now seal-cell--empty"><b>—</b></span>`;
    this.sealNow.querySelector(".seal-now-name")!.textContent = s
      ? `${s.en} · ${s.kanji}   ${Math.round(score * 100)}%`
      : "—";
    this.sealNow.classList.toggle("on", Boolean(s));
  }

  // ── rolling battle log ──
  showLog(): void {
    this.logEl.hidden = false;
  }
  hideLog(): void {
    this.logEl.hidden = true;
    this.logEl.innerHTML = "";
  }
  setLog(lines: string[]): void {
    this.logEl.innerHTML = lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function eq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const Overlay = new OverlayController();
