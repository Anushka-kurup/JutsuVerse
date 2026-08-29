// Wire protocol now lives in @jutsu/protocol (the server's package); seal/skill
// catalogues stay in ../../shared.
export * from "@jutsu/protocol";
export * from "../../shared/handSigns";
export * from "../../shared/skills";

/** Which fighter a derived battle beat belongs to, from the local player's POV. */
export type Side = "me" | "opp";

export interface ConnectOpts {
  server: string;
  room: string;
  player: string;
}
