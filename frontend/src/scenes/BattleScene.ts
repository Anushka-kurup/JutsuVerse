import Phaser from "phaser";
import { bus, Events } from "../core/EventBus";
import { SPAWN } from "../core/GameConfig";
import { net } from "../core/Session";
import { Character } from "../entities/Character";
import { GestureBridge } from "../gesture/GestureBridge";
import { CameraPreview } from "../gesture/CameraPreview";
import { SkillMatcher } from "../gesture/SkillMatcher";
import { Hud } from "../hud/Hud";
import { EffectsLayer } from "../layers/EffectsLayer";
import { BackgroundLayer } from "../layers/BackgroundLayer";
import { StateSync, type NetState } from "../network/StateSync";
import { VideoCall } from "../network/VideoCall";
import { Overlay } from "../ui/Overlay";
import { skillById, type Phase, type Seat, type Side } from "../types";

/**
 * Assembles the battle. The server owns the game now:
 *   GestureBridge ─SIGN_LIVE→ SkillMatcher ─SEAL_CONFIRMED→ net (input edge)
 *   net ─NET_STATE→ StateSync ─SKILL_FIRED / OPP_SEALS / DAMAGE→ overlay + fighters
 *   net ─NET_MATCH→ this → Result
 */
export class BattleScene extends Phaser.Scene {
  private me!: Character;
  private opp!: Character;
  private hud!: Hud;
  private fx!: EffectsLayer;
  private sync!: StateSync;

  private preview!: CameraPreview;
  private bridge!: GestureBridge;
  private videoCall!: VideoCall;
  private matcher!: SkillMatcher;

  /** false until the 3·2·1 countdown finishes — gates all input */
  private started = false;
  private counting = false;
  private readied = false;

  constructor() {
    super("Battle");
  }

  create(): void {
    this.started = false;
    this.counting = false;
    this.readied = false;
    new BackgroundLayer(this);

    this.preview = new CameraPreview(Overlay.cameraRoot, () => this.toggleCamera());
    this.bridge = new GestureBridge(this.preview.video, this.preview.canvas);
    this.videoCall = new VideoCall(net, this.preview.remoteVideo);
    this.matcher = new SkillMatcher();

    // fixed casting by seat: seat "a" is always char-me (Naruto), seat "b" char-opp (Haku)
    const iAmB = net.mySeat === "b";
    const meKey = iAmB ? "char-opp" : "char-me";
    const oppKey = iAmB ? "char-me" : "char-opp";
    this.me = new Character(this, SPAWN.me.x, SPAWN.me.y, 1, meKey, this.preview.video, true);
    this.opp = new Character(this, SPAWN.opp.x, SPAWN.opp.y, -1, oppKey, this.preview.remoteVideo, false);
    this.fx = new EffectsLayer(this);
    this.hud = new Hud(this);

    this.sync = new StateSync(this.me, this.opp, this.hud, this.fx);

    Overlay.showSealHud();
    Overlay.showSkillPanel();
    Overlay.showSealNow();
    // pre-round: enable camera to ready up, then the 3·2·1 countdown
    Overlay.showPrep();
    Overlay.setPrepStatus("Enable your camera to ready up");
    // TEMP central buttons — cast a jutsu directly (fires its seal sequence)
    Overlay.showSkillTest((skillId) => {
      if (!this.started) return;
      const sk = skillById(skillId);
      if (sk) for (const seal of sk.seals) net.sendSeal(seal);
    });

    this.input.keyboard?.on("keydown-D", this.toggleDebug, this);
    this.input.keyboard?.on("keydown-G", this.toggleGuide, this);

    bus.on(Events.SIGN_LIVE, this.onSignLive, this);
    bus.on(Events.SEAL_CONFIRMED, this.onSealConfirmed, this);
    bus.on(Events.SEAL_BUFFER, this.onMySeals, this);
    bus.on(Events.SKILL_FIRED, this.onSkillFired, this);
    bus.on(Events.OPP_SEALS, this.onOppSeals, this);
    bus.on(Events.OPP_SIGN, this.onOppSign, this);
    bus.on(Events.NET_STATE, this.onState, this);
    bus.on(Events.NET_MATCH, this.onNetMatch, this);
    bus.on(Events.NET_ERROR, this.onNetError, this);
    bus.on(Events.NET_CLOSE, this.onNetClose, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
  }

  update(): void {
    this.me.tick();
    this.opp.tick();
    this.preview.setHoldProgress(this.bridge.active ? this.matcher.confirmProgress() : 0);
    if (Overlay.debugVisible) Overlay.setDebug(this.debugText());
  }

  private toggleDebug(): void {
    Overlay.setDebug(Overlay.debugVisible ? null : this.debugText());
  }
  private toggleGuide(): void {
    Overlay.toggleSealGuide();
  }

  private debugText(): string {
    const d = this.bridge.debug;
    const top = d.top.map((e) => `  [${e.index}] ${e.id.padEnd(8)} ${(e.score * 100).toFixed(0)}%`).join("\n");
    const [lo, hi] = d.valueRange;
    return [
      `model out : ${d.dims.join("×") || "?"}   classes ${d.numClasses}/${d.handSignsLen}`,
      `best obj  : ${d.obj.toFixed(2)}   class val: ${lo.toFixed(2)}‥${hi.toFixed(2)}`,
      `camera    : ${this.bridge.active ? "on" : "off"}   seat: ${net.mySeat ?? "?"}`,
      `top classes (threshold ignored):`,
      top || "  (nothing over 1%)",
      ``,
      `hold Tiger 寅 steady → expect [2] tiger to lead.  D = hide`,
    ].join("\n");
  }

  // ── gesture ──
  private onSignLive(d: { id: string | null; score: number }): void {
    this.matcher.feed(d.id);
    this.preview.setSign(d.id, d.score);
    Overlay.setSealNow(d.id, d.score);
    Overlay.setLiveSign("me", d.id ?? "none");
  }

  private onSealConfirmed(id: string): void {
    if (!this.started) return; // input is locked until the countdown finishes
    net.sendSeal(id); // → server input edge; the server matches & resolves
  }

  // ── state → overlay ──
  private onMySeals(ids: string[]): void {
    this.preview.setSequence(ids);
    Overlay.setSeals("me", ids);
    Overlay.highlightSkills(ids);
  }
  private onSkillFired(p: { side: Side; skillId: string }): void {
    Overlay.flashSkill(p.side, p.skillId);
  }
  private onOppSeals(ids: string[]): void {
    Overlay.setSeals("opp", ids);
  }
  private onOppSign(id: string): void {
    Overlay.setLiveSign("opp", id);
  }

  private async toggleCamera(): Promise<void> {
    if (this.bridge.active) {
      this.bridge.stop();
      this.videoCall.setLocalStream(null);
      this.preview.setEnabled(false);
      return;
    }
    try {
      this.preview.setBusy("Loading model…");
      const stream = await this.bridge.start();
      this.videoCall.setLocalStream(stream);
      this.preview.setEnabled(true);
      if (!this.readied) {
        this.readied = true;
        net.ready(); // camera's on → tell the server; round starts when both are ready
        if (!this.started) Overlay.setPrepStatus("You're ready — waiting for opponent's camera…");
      }
    } catch (err) {
      console.error(err);
      this.preview.setBusy("Camera / model failed — retry");
    }
  }

  private onState(s: NetState): void {
    this.sync.apply(s);
  }

  private onNetMatch(m: { phase: Phase; winner: Seat | "draw" | null }): void {
    if (m.phase === "live" && !this.started && !this.counting) {
      // both players readied (= both cameras on) → run the 3·2·1
      this.counting = true;
      Overlay.hidePrep();
      this.runCountdown();
    } else if (m.phase === "ended") {
      this.started = false;
      this.counting = false;
      this.matcher.reset();
      const iWon = m.winner !== "draw" && m.winner === net.mySeat;
      this.scene.launch("Result", { winner: m.winner ?? "draw", iWon });
    }
  }

  private runCountdown(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 30;
    const steps = ["3", "2", "1", "GO!"];
    let i = 0;
    const tick = (): void => {
      const last = i === steps.length - 1;
      const label = this.add
        .text(cx, cy, steps[i], {
          fontFamily: "Impact, system-ui, sans-serif",
          fontSize: last ? "108px" : "132px",
          color: last ? "#4ade80" : "#ffd166",
          stroke: "#05070c",
          strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1000);
      this.tweens.add({
        targets: label,
        scale: { from: 1.7, to: 1 },
        alpha: { from: 1, to: 0 },
        duration: 850,
        ease: "Quad.out",
        onComplete: () => label.destroy(),
      });
      i += 1;
      if (i < steps.length) this.time.delayedCall(1000, tick);
      else this.time.delayedCall(650, () => {
        this.started = true;
        this.counting = false;
      });
    };
    tick();
  }

  private onNetError(msg: string): void {
    this.bailToMenu(msg);
  }
  private onNetClose(): void {
    this.bailToMenu("Disconnected from server");
  }

  private bailToMenu(msg: string): void {
    this.scene.stop("Result");
    this.scene.start("Menu");
    Overlay.setMenuError(msg);
  }

  private teardown(): void {
    bus.off(Events.SIGN_LIVE, this.onSignLive, this);
    bus.off(Events.SEAL_CONFIRMED, this.onSealConfirmed, this);
    bus.off(Events.SEAL_BUFFER, this.onMySeals, this);
    bus.off(Events.SKILL_FIRED, this.onSkillFired, this);
    bus.off(Events.OPP_SEALS, this.onOppSeals, this);
    bus.off(Events.OPP_SIGN, this.onOppSign, this);
    bus.off(Events.NET_STATE, this.onState, this);
    bus.off(Events.NET_MATCH, this.onNetMatch, this);
    bus.off(Events.NET_ERROR, this.onNetError, this);
    bus.off(Events.NET_CLOSE, this.onNetClose, this);
    this.input.keyboard?.off("keydown-D", this.toggleDebug, this);
    this.input.keyboard?.off("keydown-G", this.toggleGuide, this);

    this.bridge.stop();
    this.videoCall.destroy();
    this.preview.destroy();
    this.me.destroy();
    this.opp.destroy();
    this.fx.clear();

    Overlay.setDebug(null);
    Overlay.hidePrep();
    Overlay.hideSealGuide();
    Overlay.hideSkillPanel();
    Overlay.hideSkillTest();
    Overlay.hideSealNow();
    Overlay.hideSealHud();
    Overlay.hideLog();
  }
}
