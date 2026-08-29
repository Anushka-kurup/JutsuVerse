import type { FighterPublic, Sign } from "@jutsu/protocol";
import { BufferRail } from "./BufferRail.tsx";

const STANCE_LABEL: Record<FighterPublic["stance"], string> = {
  idle: "idle",
  startup: "sealing",
  active: "strike",
  recover: "recover",
  block: "guard",
  hitstun: "hit",
};

export function FighterCard({
  name,
  you,
  fighter,
}: {
  name: string;
  you: boolean;
  fighter: FighterPublic;
}) {
  return (
    <article className={`card ${you ? "card-you" : "card-them"} stance-${fighter.stance}`}>
      <header className="card-head">
        <div>
          <p className="kicker">{you ? "you" : "opponent"}</p>
          <h2>{name}</h2>
        </div>
        <div className={`stamp stance-${fighter.stance}`}>
          {STANCE_LABEL[fighter.stance]}
          {fighter.moveId && fighter.stance !== "idle" ? (
            <em>{fighter.moveId}</em>
          ) : null}
        </div>
      </header>
      <BufferRail
        signs={fighter.buffer as Sign[]}
        label={you ? "your seals" : "their seals"}
      />
    </article>
  );
}
