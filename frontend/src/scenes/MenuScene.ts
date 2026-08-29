import Phaser from "phaser";
import { bus, Events } from "../core/EventBus";
import { STAGE_WIDTH } from "../core/GameConfig";
import { net } from "../core/Session";
import { Overlay } from "../ui/Overlay";
import type { ConnectOpts, Phase } from "../types";

/**
 * Menu + lobby. The DOM form (Overlay) either "Create room" (no code → server
 * allocates one) or "Join room" (with a code). After connecting we sit in the
 * lobby showing the room code until the match goes `live` (both players ready),
 * then start Battle.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super("Menu");
  }

  create(): void {
    this.add.rectangle(0, 0, STAGE_WIDTH, this.scale.height, 0x0b0f17).setOrigin(0);

    Overlay.showMenu();
    Overlay.hideSealPad();
    Overlay.hideSealHud();
    Overlay.hideSkillPanel();
    Overlay.hideSealGuide();
    Overlay.setDebug(null);
    Overlay.hideLog();

    bus.on(Events.CONNECT_REQUEST, this.onConnectRequest, this);
    bus.on(Events.RESET_REQUEST, this.onCancel, this);
    bus.on(Events.NET_JOINED, this.onJoined, this);
    bus.on(Events.PEER_JOINED, this.onPeerJoined, this);
    bus.on(Events.NET_MATCH, this.onMatch, this);
    bus.on(Events.NET_ERROR, this.onError, this);
    bus.on(Events.NET_CLOSE, this.onClose, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off(Events.CONNECT_REQUEST, this.onConnectRequest, this);
      bus.off(Events.RESET_REQUEST, this.onCancel, this);
      bus.off(Events.NET_JOINED, this.onJoined, this);
      bus.off(Events.PEER_JOINED, this.onPeerJoined, this);
      bus.off(Events.NET_MATCH, this.onMatch, this);
      bus.off(Events.NET_ERROR, this.onError, this);
      bus.off(Events.NET_CLOSE, this.onClose, this);
    });
  }

  private onConnectRequest(opts: ConnectOpts): void {
    Overlay.setMenuError("connecting…");
    net.connect(opts);
  }

  private onJoined(info: { code: string; peerPresent: boolean }): void {
    Overlay.showLobby(info.code, info.peerPresent);
  }

  private onPeerJoined(): void {
    Overlay.setLobbyStatus("Opponent joined — starting…");
  }

  private onMatch(m: { phase: Phase }): void {
    if (m.phase === "live") {
      Overlay.hideLobby();
      this.scene.start("Battle");
    }
  }

  private onCancel(): void {
    net.disconnect();
    Overlay.showMenu();
  }

  private onError(msg: string): void {
    Overlay.showMenu();
    Overlay.setMenuError(msg);
  }

  private onClose(): void {
    Overlay.showMenu();
  }
}
