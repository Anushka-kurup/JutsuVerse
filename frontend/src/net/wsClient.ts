import type { ClientMsg, ServerMsg } from "@jutsu/protocol";

export function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private seq = 0;
  private queue: ClientMsg[] = [];
  private onMsg: ((msg: ServerMsg) => void) | null = null;

  get nextSeq(): number {
    return ++this.seq;
  }

  connect(handler: (msg: ServerMsg) => void): void {
    this.close();
    this.seq = 0;
    this.onMsg = handler;
    this.ws = new WebSocket(wsUrl());
    this.ws.onopen = () => {
      for (const msg of this.queue) this.ws?.send(JSON.stringify(msg));
      this.queue = [];
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMsg;
        this.onMsg?.(msg);
      } catch {
        /* ignore */
      }
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.queue = [];
  }
}
