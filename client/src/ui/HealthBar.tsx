import { MAX_HP, type FighterPublic } from "@jutsu/protocol";
import { GUARD_TICKS } from "./moves.ts";

export function HealthBar({
  name,
  you,
  fighter,
}: {
  name: string;
  you: boolean;
  fighter: FighterPublic;
}) {
  const pct = Math.max(0, Math.min(100, (fighter.hp / MAX_HP) * 100));
  const guardPct =
    fighter.guardLeft > 0
      ? Math.max(0, Math.min(100, (fighter.guardLeft / GUARD_TICKS) * 100))
      : 0;

  return (
    <div className={`hp-hud ${you ? "hp-left" : "hp-right"}`}>
      <div className="hp-meta">
        <span className="hp-tag">{you ? "you" : "foe"}</span>
        <span className="hp-name">{name}</span>
      </div>
      <div className="hp-track" aria-label={`${fighter.hp} of ${MAX_HP} hp`}>
        <div className="hp-fill" style={{ width: `${pct}%` }} />
        {guardPct > 0 ? (
          <div className="hp-guard" style={{ width: `${guardPct}%` }} />
        ) : null}
      </div>
    </div>
  );
}
