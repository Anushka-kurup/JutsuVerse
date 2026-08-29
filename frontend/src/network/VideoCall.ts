import { bus, Events } from "../core/EventBus";
import type { NetworkClient } from "./NetworkClient";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type SignalPayload =
  | { kind: "description"; description: RTCSessionDescriptionInit }
  | { kind: "candidate"; candidate: RTCIceCandidateInit };

/**
 * Peer-to-peer webcam call so each fighter shows the other player's face.
 * Signalling rides the server's opaque `signal` relay (@jutsu/protocol).
 *
 * Uses the WebRTC "perfect negotiation" pattern so it works no matter which
 * player enables their camera first (or if both do at once). Seat "b" is the
 * polite peer. The connection is created as soon as both players are in the
 * room; tracks are added when the local camera turns on, which triggers an
 * offer automatically.
 */
export class VideoCall {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private makingOffer = false;
  private ignoreOffer = false;

  constructor(
    private readonly net: NetworkClient,
    private readonly remoteVideo: HTMLVideoElement,
  ) {
    bus.on(Events.PEER_JOINED, this.ensurePc, this);
    bus.on(Events.PEER_LEFT, this.reset, this);
    bus.on(Events.WEBRTC_SIGNAL, this.onSignal, this);
    bus.on(Events.NET_CLOSE, this.reset, this);
    if (this.net.peerPresent) this.ensurePc();
  }

  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
    if (!stream) {
      this.reset();
      return;
    }
    this.ensurePc();
    this.attachTracks();
  }

  private attachTracks(): void {
    const pc = this.pc;
    const stream = this.localStream;
    if (!pc || !stream) return;
    for (const track of stream.getTracks()) {
      if (!pc.getSenders().some((s) => s.track === track)) pc.addTrack(track, stream);
    }
  }

  destroy(): void {
    bus.off(Events.PEER_JOINED, this.ensurePc, this);
    bus.off(Events.PEER_LEFT, this.reset, this);
    bus.off(Events.WEBRTC_SIGNAL, this.onSignal, this);
    bus.off(Events.NET_CLOSE, this.reset, this);
    this.reset();
  }

  private get polite(): boolean {
    return this.net.mySeat === "b";
  }

  private ensurePc(): void {
    if (this.pc || !this.net.peerPresent) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ kind: "candidate", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      this.remoteVideo.srcObject = e.streams[0] ?? null;
      this.remoteVideo.play().catch(() => {});
    };
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ kind: "description", description: pc.localDescription! });
      } catch (err) {
        console.error("[VideoCall] negotiation", err);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") pc.restartIce();
    };

    // camera already on before the peer arrived → attach now (triggers the offer)
    this.attachTracks();
  }

  private onSignal(raw: unknown): void {
    void this.handleSignal(raw).catch((err) => console.error("[VideoCall] signal", err));
  }

  private async handleSignal(raw: unknown): Promise<void> {
    const msg = raw as SignalPayload;
    if (!msg || typeof msg !== "object") return;
    this.ensurePc();
    const pc = this.pc;
    if (!pc) return;

    if (msg.kind === "description") {
      const desc = msg.description;
      const offerCollision =
        desc.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      await pc.setRemoteDescription(desc);
      if (desc.type === "offer") {
        await pc.setLocalDescription();
        this.send({ kind: "description", description: pc.localDescription! });
      }
    } else if (msg.kind === "candidate") {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        if (!this.ignoreOffer) throw err;
      }
    }
  }

  private send(payload: SignalPayload): void {
    this.net.signal(payload);
  }

  private reset(): void {
    this.pc?.close();
    this.pc = null;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.remoteVideo.srcObject = null;
  }
}
