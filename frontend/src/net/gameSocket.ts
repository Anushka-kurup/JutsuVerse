import type { ClientMsg, Edge, ServerMsg, Sign } from "@jutsu/protocol";

interface GameSocketHandlers {
  onMessage: (message: ServerMsg) => void;
  onClose: () => void;
  onError: () => void;
}

export class GameSocket {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private queued: ClientMsg[] = [];

  constructor(private readonly handlers: GameSocketHandlers) {}

  connect(server: string, room: string, playerName: string): void {
    const socket = new WebSocket(webSocketUrl(server));
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.send({ type: "join", code: room, name: playerName });
      for (const message of this.queued.splice(0)) {
        socket.send(JSON.stringify(message));
      }
    });

    socket.addEventListener("message", (event) => {
      try {
        this.handlers.onMessage(JSON.parse(String(event.data)) as ServerMsg);
      } catch {
        // Ignore malformed server frames. The server validates client frames.
      }
    });

    socket.addEventListener("close", this.handlers.onClose);
    socket.addEventListener("error", this.handlers.onError);
  }

  sendReady(): void {
    this.send({ type: "ready" });
  }

  sendInput(sign: Sign, edge: Edge): void {
    this.send({
      type: "input",
      seq: ++this.sequence,
      sign,
      edge,
      tClient: performance.now(),
    });
  }

  sendSignal(payload: unknown): void {
    this.send({ type: "signal", payload });
  }

  resetMatch(): void {
    this.send({ type: "reset" });
  }

  close(): void {
    this.send({ type: "leave" });
    this.socket?.close();
    this.socket = null;
    this.queued = [];
  }

  private send(message: ClientMsg): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.queued.push(message);
  }
}

function webSocketUrl(server: string): string {
  const url = new URL(server);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}
