import { bus, Events } from "../core/EventBus";
import { session } from "../core/Session";
import type { MemeChallengeView, SpecialView } from "../network/NetworkClient";
import {
  HAND_SIGNS,
  SEAL_IDS,
  signById,
  SKILLS,
  skillById,
  skillForPrefix,
  type Side,
} from "../types";
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
  private overlayEl!: HTMLElement;
  private camMount!: HTMLElement;
  private contest!: HTMLElement;
  private contestSides: Record<Side, { reps: HTMLElement; bar: HTMLElement }> = {} as never;
  private contestRepsShown: Record<Side, number> = { me: -1, opp: -1 };
  private memeChallenge!: HTMLElement;
  private memeSides: Record<Side, HTMLElement> = {} as never;
  private sealHud!: HTMLElement;
  private skillPanel!: HTMLElement;
  private skillCast!: HTMLElement;
  private skillTest!: HTMLElement;
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
        <div id="lobby-bg"></div>
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
          <p class="prep-hint">Both cameras are on. Press <b>START</b> — the meme challenge opens once <b>both</b> players have pressed it.</p>
          <button type="button" class="startgate-btn">▶ START</button>
          <p class="startgate-status"></p>
        </div>
        <div id="cam-mount"></div>
        <div id="contest" hidden>
          <p class="contest-title">六七 · 6-7 CONTEST</p>
          <p class="contest-hint">
            Last stand! Alternate your hands high and low. First to <b>67</b> survives with <b>+10 HP</b> — lose and the match is over.
          </p>
          <div class="contest-scores">
            ${this.contestSideHtml("me", "YOU")}
            ${this.contestSideHtml("opp", "OPPONENT")}
          </div>
          <p class="contest-clock">—</p>
          <p class="contest-status"></p>
          <p class="contest-result" hidden></p>
        </div>
        <div id="memechallenge" hidden>
          <div class="meme-body">
            <p class="meme-title">MEME CHALLENGE</p>
            <p class="meme-hint">Try the gesture below, or any other meme gesture you've got — first one recognized wins.</p>
            <img class="meme-pic" alt="" hidden>
            <p class="meme-label">—</p>
            <div class="meme-scores">
              ${this.memeSideHtml("me", "YOU")}
              ${this.memeSideHtml("opp", "OPPONENT")}
            </div>
            <p class="meme-clock">—</p>
            <p class="meme-status"></p>
            <p class="meme-result" hidden></p>
          </div>
        </div>
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
    this.overlayEl = this.app.querySelector("#overlay")!;
    this.camMount = this.app.querySelector("#cam-mount")!;
    this.contest = this.app.querySelector("#contest")!;
    for (const side of ["me", "opp"] as Side[]) {
      const el = this.contest.querySelector(`.contest-side[data-side="${side}"]`)!;
      this.contestSides[side] = {
        reps: el.querySelector(".contest-reps")!,
        bar: el.querySelector(".contest-bar > i")!,
      };
    }
    this.memeChallenge = this.app.querySelector("#memechallenge")!;
    for (const side of ["me", "opp"] as Side[]) {
      this.memeSides[side] = this.memeChallenge.querySelector(`.meme-side[data-side="${side}"] .meme-done`)!;
    }
    this.sealHud = this.app.querySelector("#seal-hud")!;
    this.skillPanel = this.app.querySelector("#skill-dock")!;
    this.skillCast = this.app.querySelector("#skill-cast")!;
    this.skillTest = this.app.querySelector("#skill-test")!;
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

  // ── start gate (both players press START, then the memegate challenge opens) ──
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

  private contestSideHtml(side: Side, label: string): string {
    return `<div class="contest-side" data-side="${side}">
      <span class="contest-who">${label}</span>
      <span class="contest-reps">0</span>
      <div class="contest-bar"><i></i></div>
    </div>`;
  }

  // ── 6-7 contest ──
  /** Contest mode hides the seal furniture; the gesture is nothing like a seal. */
  showContest(): void {
    this.contest.hidden = false;
    this.setContestMode(true);
    this.contestRepsShown = { me: -1, opp: -1 };
    this.setContestStatus("");
    const result = this.contest.querySelector<HTMLElement>(".contest-result")!;
    result.hidden = true;
    result.textContent = "";
  }

  hideContest(): void {
    this.contest.hidden = true;
    this.setContestMode(false);
  }

  /**
   * Seal furniture stays hidden only while combat is actually frozen. The result
   * banner outlives that, and by then the player can cast again — so they need
   * the jutsu dock back even though the panel is still up.
   */
  setContestMode(on: boolean): void {
    this.overlayEl.classList.toggle("contest-mode", on);
  }

  setContest(v: SpecialView): void {
    for (const side of ["me", "opp"] as Side[]) {
      const value = v.reps[side];
      const w = this.contestSides[side];
      if (value !== this.contestRepsShown[side]) {
        this.contestRepsShown[side] = value;
        w.reps.textContent = String(value);
        // a number that only changes value reads as broken even when it is right
        w.reps.classList.remove("pop");
        void w.reps.offsetWidth; // restart the animation
        w.reps.classList.add("pop");
      }
      w.bar.style.width = `${Math.min(100, (value / v.target) * 100)}%`;
      w.bar.classList.toggle("done", value >= v.target);
    }

    const clock = this.contest.querySelector<HTMLElement>(".contest-clock")!;
    clock.textContent = v.outcome ? "" : `${v.secondsLeft}s`;
    clock.classList.toggle("urgent", !v.outcome && v.secondsLeft <= 10);

    const result = this.contest.querySelector<HTMLElement>(".contest-result")!;
    result.hidden = v.outcome === null;
    if (v.outcome) {
      this.setContestStatus("");
      result.textContent = contestResultText(v);
      result.className = `contest-result contest-result--${v.outcome}`;
    }
  }

  /** Live detector feedback — without it a player cannot tell why nothing counts. */
  setContestSignal(valid: boolean): void {
    if (this.contest.hidden) return;
    if (this.contest.querySelector<HTMLElement>(".contest-result")!.hidden) {
      this.setContestStatus(valid ? "" : "Show BOTH hands to the camera");
    }
  }

  setContestStatus(text: string): void {
    const el = this.contest.querySelector<HTMLElement>(".contest-status")!;
    el.textContent = text;
    el.classList.toggle("warn", text !== "");
  }

  private memeSideHtml(side: Side, label: string): string {
    return `<div class="meme-side" data-side="${side}">
      <span class="meme-who">${label}</span>
      <span class="meme-done">—</span>
    </div>`;
  }

  // ── meme-gesture challenge (memegate starts the match; memerace is a recurring bonus) ──
  /** Challenge mode hides the seal furniture; the gesture is nothing like a seal. */
  showMemeChallenge(): void {
    this.memeChallenge.hidden = false;
    this.setMemeChallengeMode(true);
    this.setMemeStatus("");
    const result = this.memeChallenge.querySelector<HTMLElement>(".meme-result")!;
    result.hidden = true;
    result.textContent = "";
    const pic = this.memeChallenge.querySelector<HTMLImageElement>(".meme-pic")!;
    pic.hidden = true;
    pic.removeAttribute("src");
    for (const side of ["me", "opp"] as Side[]) this.memeSides[side].textContent = "—";
  }

  hideMemeChallenge(): void {
    this.memeChallenge.hidden = true;
    this.setMemeChallengeMode(false);
  }

  /** Seal furniture stays hidden while combat is frozen (memerace) or the match
   * hasn't started yet (memegate) — see setContestMode's own note. */
  setMemeChallengeMode(on: boolean): void {
    this.overlayEl.classList.toggle("meme-mode", on);
  }

  setMemeChallenge(v: MemeChallengeView): void {
    this.memeChallenge.querySelector(".meme-label")!.textContent = memeLabelText(v.label);

    const pic = this.memeChallenge.querySelector<HTMLImageElement>(".meme-pic")!;
    if (v.image) {
      const url = import.meta.env.BASE_URL + v.image;
      if (pic.getAttribute("src") !== url) pic.src = url;
      pic.alt = memeLabelText(v.label);
      pic.hidden = false;
    } else {
      pic.hidden = true;
      pic.removeAttribute("src");
    }

    for (const side of ["me", "opp"] as Side[]) {
      this.memeSides[side].textContent = v.done[side] ? "✓" : "—";
    }
    const clock = this.memeChallenge.querySelector<HTMLElement>(".meme-clock")!;
    clock.textContent = v.outcome ? "" : `${v.secondsLeft}s`;
    clock.classList.toggle("urgent", !v.outcome && v.secondsLeft <= 3);

    const result = this.memeChallenge.querySelector<HTMLElement>(".meme-result")!;
    result.hidden = v.outcome === null;
    if (v.outcome) {
      this.setMemeStatus("");
      result.textContent = memeResultText(v);
      result.className = `meme-result meme-result--${v.outcome}`;
    }
  }

  /** Live detector feedback — without it a player cannot tell why nothing counts. */
  setMemeSignal(tracked: boolean): void {
    if (this.memeChallenge.hidden) return;
    if (this.memeChallenge.querySelector<HTMLElement>(".meme-result")!.hidden) {
      this.setMemeStatus(tracked ? "" : "Get your arms and hands in frame");
    }
  }

  setMemeStatus(text: string): void {
    const el = this.memeChallenge.querySelector<HTMLElement>(".meme-status")!;
    el.textContent = text;
    el.classList.toggle("warn", text !== "");
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
    // one card per element (+ shield). The levels of an element differ only by
    // their trailing seal, so they collapse into a single row: the shared base
    // seals are solid, each level-up seal is drawn dashed.
    const groups = new Map<string, typeof SKILLS>();
    for (const s of SKILLS) {
      const key = s.element ?? s.action;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(s);
    }

    const card = (key: string, list: typeof SKILLS): string => {
      const deepest = list.reduce((a, b) => (b.seals.length > a.seals.length ? b : a));
      const base = Math.min(...list.map((s) => s.seals.length)); // shared prefix length
      const seals = deepest.seals
        .map((id, i) =>
          sealHtml(id, i < base ? "skill-seal" : "skill-seal skill-seal--ext"),
        )
        .join("");
      const isAtk = deepest.action === "ATTACK";
      const tag = isAtk ? (deepest.element ?? "ATK") : deepest.action;
      const name = isAtk ? `${key[0]}${key.slice(1).toLowerCase()} Attack` : deepest.name;
      const ids = list.map((s) => s.id).join(",");
      return `<div class="skill-line" data-skill="${deepest.id}" data-skills="${ids}" data-group="${key}">
        <div class="skill-head">
          <span class="skill-name"><b>${name}</b></span>
          <span class="skill-tag skill-tag--${deepest.action.toLowerCase()}">${tag}</span>
        </div>
        <div class="skill-seals">${seals}</div>
      </div>`;
    };

    return [...groups.entries()].map(([key, list]) => card(key, list)).join("");
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
    // the buffer is always a live prefix now, so show which jutsu it's building:
    // its full sequence with the done seals lit and the remaining ones ghosted.
    const strip = this.rows[side].seals;
    const target = skillForPrefix(ids);

    if (!target) {
      strip.innerHTML = ids.map((id) => sealTextHtml(id)).join("");
      return;
    }

    strip.innerHTML =
      `<span class="seal-strip-name">${target.nameJa} ${ids.length}/${target.seals.length}</span>` +
      target.seals
        .map((id, i) =>
          sealTextHtml(id, i < ids.length ? "seal-cell--done" : "seal-cell--todo"),
        )
        .join("");
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
    }, 3500);

    if (side === "me") {
      // cards are merged per element, so L1/L2 casts resolve to the group card
      const row =
        this.skillPanel.querySelector(`.skill-line[data-skill="${skillId}"]`) ??
        this.skillPanel.querySelector(
          `.skill-line[data-group="${skill.element ?? skill.action}"]`,
        );
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

function contestResultText(v: SpecialView): string {
  if (v.outcome === "draw") return "DRAW — no one heals";
  const who = v.outcome === "me" ? "YOU WIN" : "OPPONENT WINS";
  return v.healed > 0 ? `${who} · +${v.healed} HP` : `${who} · already at full HP`;
}

function memeLabelText(label: string): string {
  return label.replace(/_/g, " ").toUpperCase();
}

function memeResultText(v: MemeChallengeView): string {
  if (v.outcome === "draw") return "TIME'S UP — no one heals";
  const who = v.outcome === "me" ? "YOU WIN" : "OPPONENT WINS";
  return v.healed > 0 ? `${who} · +${v.healed} HP` : `${who} · already at full HP`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function eq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const Overlay = new OverlayController();
