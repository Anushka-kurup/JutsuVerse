import { TICK_MS, type ServerMsg } from "@jutsu/protocol";
import { matchStatePublic, publicState, tickMatch } from "./match.ts";
import { allPlayers, liveRooms } from "./rooms.ts";

export function startLoop(): NodeJS.Timeout {
  return setInterval(() => {
    for (const room of liveRooms()) {
      room.match = tickMatch(room.match);
      const snap = publicState(room.match);
      const stateMsg: ServerMsg = { type: "state", ...snap };
      const payload = JSON.stringify(stateMsg);
      const matchMsg: ServerMsg = matchStatePublic(room.match);
      const matchPayload = JSON.stringify(matchMsg);
      for (const p of room.players.values()) {
        if (p.ws.readyState === p.ws.OPEN) {
          p.ws.send(payload);
          p.ws.send(matchPayload);
        }
      }
    }
  }, TICK_MS);
}

export function startHeartbeat(): NodeJS.Timeout {
  return setInterval(() => {
    for (const player of allPlayers()) {
      if (!player.alive) {
        player.ws.terminate();
        continue;
      }
      player.alive = false;
      if (player.ws.readyState === player.ws.OPEN) player.ws.ping();
    }
  }, 5000);
}
