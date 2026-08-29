import { NetworkClient } from "../network/NetworkClient";
import type { ConnectOpts } from "../types";

/**
 * One process-wide network client + the room details the player typed on the
 * menu. Scenes import these rather than passing them through scene data, so the
 * WebSocket survives Menu → Battle → Result transitions.
 */
export const net = new NetworkClient();

export const session: ConnectOpts = {
  room: "",
  player: "Ronin",
};
