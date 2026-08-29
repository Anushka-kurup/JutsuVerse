import { bus, Events } from "../core/EventBus";
import { SPAWN } from "../core/GameConfig";
import type { Character } from "../entities/Character";
import type { EffectsLayer } from "../layers/EffectsLayer";
import type { Hud } from "../hud/Hud";
import { skillById, type FighterPublic, type Side } from "../types";

const CHEST_DY = 160; // torso height above the feet — projectile spawn / land

export interface NetState {
  me: FighterPublic;
  opp: FighterPublic;
  tick: number;
}

/**
 * Maps the server's `FighterPublic` snapshots onto the visual objects + bus
 * events. The server owns all logic — this only reacts to deltas:
 *   hp ↓         → Character.hit + DAMAGE
 *   lastSkillTick advanced → SKILL_FIRED + Character.cast + projectile
 *   stance block → setDefense(PROTECT), else clear
 *   hp ≤ 0       → ko
 */
export class StateSync {
  private prev: NetState | null = null;
  private oppSealsKey = "";
  private mySealsKey = "";

  constructor(
    private readonly me: Character,
    private readonly opp: Character,
    private readonly hud: Hud,
    private readonly fx: EffectsLayer,
  ) {}

  apply(s: NetState): void {
    const { me, opp } = s;
    const prev = this.prev;

    this.hud.updateSide("me", me);
    this.hud.updateSide("opp", opp);

    this.me.setDefense(me.stance === "block" ? "PROTECT" : null);
    this.opp.setDefense(opp.stance === "block" ? "PROTECT" : null);

    // ── seal buffers → overlay ──
    const myKey = me.buffer.join(",");
    if (myKey !== this.mySealsKey) {
      this.mySealsKey = myKey;
      bus.emit(Events.SEAL_BUFFER, [...me.buffer]);
    }
    const oppKey = opp.buffer.join(",");
    if (oppKey !== this.oppSealsKey) {
      this.oppSealsKey = oppKey;
      bus.emit(Events.OPP_SEALS, [...opp.buffer]);
    }
    bus.emit(Events.OPP_SIGN, opp.held[opp.held.length - 1] ?? null);

    // ── skill fired (server set lastSkillTick this frame) ──
    if (me.lastSkill && (!prev || me.lastSkillTick > prev.me.lastSkillTick)) {
      this.playSkill("me", me.lastSkill);
    }
    if (opp.lastSkill && (!prev || opp.lastSkillTick > prev.opp.lastSkillTick)) {
      this.playSkill("opp", opp.lastSkill);
    }

    // ── hits ──
    if (prev && me.hp < prev.me.hp) {
      this.me.hit(prev.me.hp - me.hp);
      bus.emit(Events.DAMAGE, { side: "me" as Side, amount: prev.me.hp - me.hp });
    }
    if (prev && opp.hp < prev.opp.hp) {
      this.opp.hit(prev.opp.hp - opp.hp);
      bus.emit(Events.DAMAGE, { side: "opp" as Side, amount: prev.opp.hp - opp.hp });
    }

    // ── KO / revive ──
    const meDead = me.hp <= 0;
    const oppDead = opp.hp <= 0;
    if (meDead && (!prev || prev.me.hp > 0)) this.me.ko();
    if (oppDead && (!prev || prev.opp.hp > 0)) this.opp.ko();
    if (!meDead && prev && prev.me.hp <= 0) this.me.revive();
    if (!oppDead && prev && prev.opp.hp <= 0) this.opp.revive();

    this.prev = s;
  }

  private playSkill(side: Side, skillId: string): void {
    const skill = skillById(skillId);
    const char = side === "me" ? this.me : this.opp;
    bus.emit(Events.SKILL_FIRED, { side, skillId });

    if (skill?.action === "ATTACK" && skill.element) {
      char.cast(skill.element);
      const from = side === "me" ? SPAWN.me : SPAWN.opp;
      const to = side === "me" ? SPAWN.opp : SPAWN.me;
      const level = skill.level ?? 1;
      this.fx.volley(
        {
          fromX: from.x,
          fromY: from.y - CHEST_DY,
          toX: to.x,
          toY: to.y - CHEST_DY,
          element: skill.element,
          skillId: skill.id,
          level,
        },
        level, // level 1/2/3 → 1/2/3 projectiles
      );
    } else {
      char.pulseDefense("PROTECT");
      char.cast("NEUTRAL");
    }
  }
}
