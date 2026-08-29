import { bus, Events } from "../core/EventBus";
import { sfx } from "../core/Sfx";
import { SPAWN } from "../core/GameConfig";
import type { Character } from "../entities/Character";
import type { EffectsLayer } from "../layers/EffectsLayer";
import type { Hud } from "../hud/Hud";
import { skillById, skillForPrefix, type FighterPublic, type Side } from "../types";

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

    // ── skill fired (server set lastSkillTick this frame) — run before the seal
    //    diff so a firing charge gets a release flare, not a dismiss ──
    if (me.lastSkill && (!prev || me.lastSkillTick > prev.me.lastSkillTick)) {
      this.playSkill("me", me.lastSkill);
    }
    if (opp.lastSkill && (!prev || opp.lastSkillTick > prev.opp.lastSkillTick)) {
      this.playSkill("opp", opp.lastSkill);
    }

    // ── seal buffers → overlay strip + the charging-jutsu visual ──
    this.syncSeals("me", me.buffer);
    this.syncSeals("opp", opp.buffer);
    bus.emit(Events.OPP_SIGN, opp.held[opp.held.length - 1] ?? null);

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
    if (meDead && (!prev || prev.me.hp > 0)) {
      this.me.ko();
      this.fx.clearCharge("me");
    }
    if (oppDead && (!prev || prev.opp.hp > 0)) {
      this.opp.ko();
      this.fx.clearCharge("opp");
    }
    if (!meDead && prev && prev.me.hp <= 0) this.me.revive();
    if (!oppDead && prev && prev.opp.hp <= 0) this.opp.revive();

    this.prev = s;
  }

  /** Buffer changed → update the HUD strip and the growing charge orb. */
  private syncSeals(side: Side, buffer: string[]): void {
    const key = buffer.join(",");
    if (side === "me") {
      if (key === this.mySealsKey) return;
      this.mySealsKey = key;
      bus.emit(Events.SEAL_BUFFER, [...buffer]);
    } else {
      if (key === this.oppSealsKey) return;
      this.oppSealsKey = key;
      bus.emit(Events.OPP_SEALS, [...buffer]);
    }

    const skill = skillForPrefix(buffer);
    if (skill?.action === "ATTACK" && skill.element && buffer.length >= 1) {
      const at = side === "me" ? SPAWN.me : SPAWN.opp;
      const facing: 1 | -1 = side === "me" ? 1 : -1;
      this.fx.charge(
        side,
        { x: at.x, y: at.y - CHEST_DY, element: skill.element, skillId: skill.id, facing },
        buffer.length,
        skill.seals.length,
      );
    } else {
      this.fx.clearCharge(side);
    }
  }

  private playSkill(side: Side, skillId: string): void {
    const skill = skillById(skillId);
    const char = side === "me" ? this.me : this.opp;
    bus.emit(Events.SKILL_FIRED, { side, skillId });

    if (skill?.action === "ATTACK" && skill.element) {
      // at cast, not at impact: the clip runs the length of the projectile's
      // flight and its tail lands on the hit
      sfx.play(skill.element.toLowerCase());
      char.cast(skill.element);
      this.fx.releaseCharge(side);
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
        level, // level 1/2 → 1/2 projectiles
      );
    } else {
      this.fx.clearCharge(side);
      char.pulseDefense("PROTECT");
      char.cast("NEUTRAL");
    }
  }
}
