import Phaser from "phaser";
import { bus, Events } from "../core/EventBus";
import { SPAWN } from "../core/GameConfig";
import { music } from "../core/Music";
import { sfx } from "../core/Sfx";
import { net } from "../core/Session";
import { Character } from "../entities/Character";
import { GestureBridge } from "../gesture/GestureBridge";
import { CameraPreview } from "../gesture/CameraPreview";
import { SkillMatcher } from "../gesture/SkillMatcher";
import { SixSevenBridge, type SixSevenSignal } from "../gesture/SixSevenBridge";
import { MemeBridge } from "../gesture/MemeBridge";
import { Hud } from "../hud/Hud";
import { EffectsLayer } from "../layers/EffectsLayer";
import { BackgroundLayer } from "../layers/BackgroundLayer";
import { StateSync, type NetState } from "../network/StateSync";
import { VideoCall } from "../network/VideoCall";
import type { MemeChallengeView, SpecialView } from "../network/NetworkClient";
import { Overlay } from "../ui/Overlay";
import { type Phase, type Seat, type Side } from "../types";

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

  private memeBridge!: MemeBridge;
  /** true during memegate (pre-match) or a memerace (mid-battle heal round) */
  private inMemeChallenge = false;
  private currentMemeLabel: string | null = null;

  /** false until the match is actually live — gates all input */
  private started = false;
  /** camera enabled locally (gate 1) */
  private camReadied = false;
  /** START pressed locally (gate 2) */
  private startPressed = false;

  constructor() {
    super("Battle");
  }

  create(): void {
    this.started = false;
    this.camReadied = false;
    this.startPressed = false;
    this.inSpecial = false;
    this.inMemeChallenge = false;
    this.currentMemeLabel = null;
    new BackgroundLayer(this);

    this.preview = new CameraPreview(Overlay.cameraRoot, () => this.toggleCamera());
    this.bridge = new GestureBridge(this.preview.video, this.preview.canvas);
    this.videoCall = new VideoCall(net, this.preview.remoteVideo);
    this.matcher = new SkillMatcher();
    this.sixSeven = new SixSevenBridge(this.preview.video);
    this.memeBridge = new MemeBridge(this.preview.video);

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
    // pre-round: enable camera to ready up, then the meme-gate starts the match
    Overlay.showPrep();
    Overlay.setPrepStatus("Enable your camera to ready up");

    this.input.keyboard?.on("keydown-D", this.toggleDebug, this);
    this.input.keyboard?.on("keydown-G", this.toggleGuide, this);
    this.input.keyboard?.on("keydown-M", this.toggleMusic, this);

    bus.on(Events.SIGN_LIVE, this.onSignLive, this);
    bus.on(Events.SIXSEVEN_REPS, this.onReps, this);
    bus.on(Events.SIXSEVEN_SIGNAL, this.onSixSevenSignal, this);
    bus.on(Events.MEME_RECOGNIZED, this.onMemeRecognized, this);
    bus.on(Events.MEME_SIGNAL, this.onMemeSignal, this);
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
  private toggleMusic(): void {
    sfx.setMuted(music.toggleMute());
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
    if (!this.started || this.inSpecial || this.inMemeChallenge) return; // locked outside live play
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

  // ── meme-gesture challenge (memegate starts the match; memerace is a recurring bonus) ──
  private onMemeRecognized(p: { label: string }): void {
    if (this.inMemeChallenge) net.sendMeme(p.label);
  }

  private onMemeSignal(p: { tracked: boolean }): void {
    if (this.inMemeChallenge) Overlay.setMemeSignal(p.tracked);
  }

  /** Swap the seal detector out for the meme classifier — both read the same camera. */
  private enterMemeChallenge(view: MemeChallengeView): void {
    if (!this.inMemeChallenge) {
      this.inMemeChallenge = true;
      this.matcher.reset();
      net.setHeldSign(null);
      this.bridge.pauseDetection();
      Overlay.showMemeChallenge();
    }

    if (!this.bridge.active) {
      Overlay.setMemeStatus("Camera is off — turn it on to compete");
    } else if (!this.memeBridge.active) {
      this.memeBridge.start().catch((err) => {
        console.error("[meme]", err);
        Overlay.setMemeStatus("Gesture tracking failed to start");
      });
    }

    // the shown label is just a suggestion now (see MemeBridge) — a change
    // still means "fresh attempt", so reset in-progress recognition state
    if (view.label !== this.currentMemeLabel) {
      this.currentMemeLabel = view.label;
      this.memeBridge.reset();
    }
  }

  private exitMemeChallenge(): void {
    if (!this.inMemeChallenge) return;
    this.inMemeChallenge = false;
    this.currentMemeLabel = null;
    this.memeBridge.stop();
    this.bridge.resumeDetection();
    Overlay.setMemeChallengeMode(false);
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
      // warm the 6-7 and meme models now; both challenges start with no warning
      void this.sixSeven.preload().catch((err) => console.error("[6-7] preload", err));
      void this.memeBridge.preload().catch((err) => console.error("[meme] preload", err));
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
    special?: SpecialView | null;
    memeChallenge?: MemeChallengeView | null;
  }): void {
    // Detector swap follows the phase, but each panel follows its own block,
    // which outlives the phase by a few ticks so the result can be read.
    if (m.phase === "special") this.enterSpecial();
    else if (this.inSpecial) this.exitSpecial();

    if (m.special) Overlay.setContest(m.special);
    else Overlay.hideContest();

    if (m.phase === "memegate" || m.phase === "memerace") {
      if (m.memeChallenge) this.enterMemeChallenge(m.memeChallenge);
    } else if (this.inMemeChallenge) {
      this.exitMemeChallenge();
    }
    if (m.memeChallenge) Overlay.setMemeChallenge(m.memeChallenge);
    else Overlay.hideMemeChallenge();

    if (m.phase === "connecting") {
      // gate 1 done (both cameras on) → gate 2: both players press START
      Overlay.hidePrep();
      if (!this.startPressed) {
        Overlay.showStartGate(() => {
          this.startPressed = true;
          net.startReady();
        });
      }
    } else if (m.phase === "memegate") {
      this.started = false;
      Overlay.hidePrep();
      Overlay.hideStartGate();
    } else if (m.phase === "live" && !this.started) {
      this.started = true;
    } else if (m.phase === "ended") {
      this.started = false;
      this.startPressed = false;
      this.matcher.reset();
      Overlay.hideContest();
      Overlay.hideMemeChallenge();
      const iWon = m.winner !== "draw" && m.winner === net.mySeat;
      this.scene.launch("Result", { winner: m.winner ?? "draw", iWon });
    }
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
    bus.off(Events.MEME_RECOGNIZED, this.onMemeRecognized, this);
    bus.off(Events.MEME_SIGNAL, this.onMemeSignal, this);
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
    this.input.keyboard?.off("keydown-M", this.toggleMusic, this);

    this.sixSeven.stop();
    this.memeBridge.stop();
    this.bridge.stop();
    this.videoCall.destroy();
    this.preview.destroy();
    this.me.destroy();
    this.opp.destroy();
    this.fx.clear();

    Overlay.setDebug(null);
    Overlay.hideContest();
    Overlay.hideMemeChallenge();
    Overlay.hidePrep();
    Overlay.hideStartGate();
    Overlay.hideSealGuide();
    Overlay.hideSkillPanel();
    Overlay.hideSkillTest();
    Overlay.hideSealHud();
    Overlay.hideLog();
  }
}
