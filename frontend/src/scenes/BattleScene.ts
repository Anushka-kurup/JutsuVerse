import Phaser from "phaser";
import { bus, Events } from "../core/EventBus";
import { SPAWN } from "../core/GameConfig";
import { net } from "../core/Session";
import { Character } from "../entities/Character";
import { GestureBridge } from "../gesture/GestureBridge";
import { CameraPreview } from "../gesture/CameraPreview";
import { SkillMatcher } from "../gesture/SkillMatcher";
import { SixSevenBridge, type SixSevenSignal } from "../gesture/SixSevenBridge";
import { Hud } from "../hud/Hud";
import { EffectsLayer } from "../layers/EffectsLayer";
import { BackgroundLayer } from "../layers/BackgroundLayer";
import { StateSync, type NetState } from "../network/StateSync";
import { VideoCall } from "../network/VideoCall";
import type { SpecialView } from "../network/NetworkClient";
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
  private sixSeven!: SixSevenBridge;
  /** true while the 6-7 contest has combat frozen */
  private inSpecial = false;

  /** false until the 3·2·1 countdown finishes — gates all input */
  private started = false;
  /** camera enabled locally (gate 1) */
  private camReadied = false;
  /** START pressed locally (gate 2) */
  private startPressed = false;
  private countdownLabel?: Phaser.GameObjects.Text;
  private countdownValue: number | null = null;

  constructor() {
    super("Battle");
  }

  create(): void {
    this.started = false;
    this.camReadied = false;
    this.startPressed = false;
    this.inSpecial = false;
    this.countdownValue = null;
    new BackgroundLayer(this);

    this.preview = new CameraPreview(Overlay.cameraRoot, () => this.toggleCamera());
    this.bridge = new GestureBridge(this.preview.video, this.preview.canvas);
    this.videoCall = new VideoCall(net, this.preview.remoteVideo);
    this.matcher = new SkillMatcher();
    this.sixSeven = new SixSevenBridge(this.preview.video);

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
    bus.on(Events.SIXSEVEN_REPS, this.onReps, this);
    bus.on(Events.SIXSEVEN_SIGNAL, this.onSixSevenSignal, this);
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
    if (this.started) net.setHeldSign(d.id);
    this.preview.setSign(d.id, d.score);
    Overlay.setLiveSign("me", d.id);
  }

  private onSealConfirmed(id: string): void {
    if (!this.started || this.inSpecial) return; // locked until the countdown, and during the contest
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
  private onOppSign(id: string | null): void {
    Overlay.setLiveSign("opp", id);
  }

  // ── 6-7 contest ──
  private onReps(reps: number): void {
    if (this.inSpecial) net.sendReps(reps);
  }

  private onSixSevenSignal(s: SixSevenSignal): void {
    if (this.inSpecial) Overlay.setContestSignal(s.valid);
  }

  /** Swap the seal detector out for the rep detector — both read the same camera. */
  private enterSpecial(): void {
    if (this.inSpecial) return;
    this.inSpecial = true;
    this.matcher.reset();
    net.setHeldSign(null);
    this.bridge.pauseDetection();
    Overlay.showContest();

    if (!this.bridge.active) {
      Overlay.setContestStatus("Camera is off — turn it on to compete");
      return;
    }
    this.sixSeven.start().catch((err) => {
      console.error("[6-7]", err);
      Overlay.setContestStatus("Hand tracking failed to start");
    });
  }

  private exitSpecial(): void {
    if (!this.inSpecial) return;
    this.inSpecial = false;
    this.sixSeven.stop();
    this.bridge.resumeDetection();
    // the result banner stays up, but combat has resumed — give the dock back
    Overlay.setContestMode(false);
  }

  private async toggleCamera(): Promise<void> {
    if (this.bridge.active) {
      net.setHeldSign(null);
      if (!this.started) net.cameraReady(false);
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
      // warm the 6-7 landmark model now; the contest starts with no warning
      void this.sixSeven.preload().catch((err) => console.error("[6-7] preload", err));
      if (!this.camReadied) {
        this.camReadied = true;
        net.cameraReady(); // gate 1 cleared → the start banner shows once both cameras are on
        if (!this.started) Overlay.setPrepStatus("Camera on — waiting for opponent's camera…");
      }
    } catch (err) {
      console.error(err);
      this.preview.setBusy("Camera / model failed — retry");
    }
  }

  private onState(s: NetState): void {
    this.sync.apply(s);
  }

  private onNetMatch(m: {
    phase: Phase;
    winner: Seat | "draw" | null;
    countdown?: number | null;
    special?: SpecialView | null;
  }): void {
    // Detector swap follows the phase, but the panel follows the `special` block,
    // which outlives the phase by a few ticks so the result can be read.
    if (m.phase === "special") this.enterSpecial();
    else if (this.inSpecial) this.exitSpecial();

    if (m.special) Overlay.setContest(m.special);
    else Overlay.hideContest();

    if (m.phase === "connecting") {
      // gate 1 done (both cameras on) → gate 2: both players press START
      Overlay.hidePrep();
      if (!this.startPressed) {
        Overlay.showStartGate(() => {
          this.startPressed = true;
          net.startReady();
        });
      }
    } else if (m.phase === "countdown") {
      // The server owns the countdown, so both clients render the same value.
      this.started = false;
      Overlay.hidePrep();
      Overlay.hideStartGate();
      this.showCountdown(m.countdown ?? 3);
    } else if (m.phase === "live" && !this.started) {
      this.countdownLabel?.destroy();
      this.countdownLabel = undefined;
      this.countdownValue = null;
      this.started = true;
    } else if (m.phase === "ended") {
      this.started = false;
      this.startPressed = false;
      this.matcher.reset();
      Overlay.hideContest();
      const iWon = m.winner !== "draw" && m.winner === net.mySeat;
      this.scene.launch("Result", { winner: m.winner ?? "draw", iWon });
    }
  }

  private showCountdown(value: number): void {
    if (value === this.countdownValue) return;
    this.countdownValue = value;
    this.countdownLabel?.destroy();
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 30;
    this.countdownLabel = this.add
      .text(cx, cy, String(value), {
        fontFamily: "Impact, system-ui, sans-serif",
        fontSize: "132px",
        color: value === 0 ? "#4ade80" : "#ffd166",
        stroke: "#05070c",
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1000);
    this.tweens.add({
      targets: this.countdownLabel,
      scale: { from: 1.7, to: 1 },
      duration: 300,
      ease: "Quad.out",
    });
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
    bus.off(Events.SIXSEVEN_REPS, this.onReps, this);
    bus.off(Events.SIXSEVEN_SIGNAL, this.onSixSevenSignal, this);
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

    this.sixSeven.stop();
    this.bridge.stop();
    this.countdownLabel?.destroy();
    this.videoCall.destroy();
    this.preview.destroy();
    this.me.destroy();
    this.opp.destroy();
    this.fx.clear();

    Overlay.setDebug(null);
    Overlay.hideContest();
    Overlay.hidePrep();
    Overlay.hideStartGate();
    Overlay.hideSealGuide();
    Overlay.hideSkillPanel();
    Overlay.hideSkillTest();
    Overlay.hideSealHud();
    Overlay.hideLog();
  }
}
