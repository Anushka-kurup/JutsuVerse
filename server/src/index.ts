import http from "node:http";
import { WebSocketServer } from "ws";
import { handleConnection } from "./hub.ts";
import { startHeartbeat, startLoop } from "./loop.ts";

const PORT = Number(process.env.PORT ?? 8080);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", handleConnection);

startLoop();
startHeartbeat();

server.listen(PORT, () => {
  console.log(`jutsu-duel server http://localhost:${PORT}  ws://localhost:${PORT}/ws`);
});
