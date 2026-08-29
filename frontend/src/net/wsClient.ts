import type { ClientMsg, ServerMsg } from "@jutsu/protocol";

/** Same-origin socket. Vite (and any prod reverse proxy) forwards `/ws` to the game server. */
export function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private seq = 0;
  private queue: ClientMsg[] = [];
  private onMsg: ((msg: ServerMsg) => void) | null = null;

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  get nextSeq(): number {
    return ++this.seq;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Open (or keep) the same-origin socket. Join/leave are messages, not new connections. */
  connect(handler: (msg: ServerMsg) => void): void {
    this.onMsg = handler;
    const state = this.ws?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    this.close();
    this.seq = 0;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      for (const msg of this.queue) ws.send(JSON.stringify(msg));
      this.queue = [];
      this.onopen?.();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMsg;
        this.onMsg?.(msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.onclose?.();
    };
    ws.onerror = () => this.onerror?.();
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.queue = [];
    ws?.close();
  }
}
