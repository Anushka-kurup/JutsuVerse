import { bus, Events } from "../core/EventBus";
import { sfx } from "../core/Sfx";
import { SPAWN } from "../core/GameConfig";
import type { Character } from "../entities/Character";
import type { EffectsLayer } from "../layers/EffectsLayer";
import type { Hud } from "../hud/Hud";
import { SKILLS, skillById, skillForPrefix, type FighterPublic, type Side } from "../types";

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
  private myChargeKey = "";
  private oppChargeKey = "";

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
    this.syncCharge("me", me.buffer, me.held[me.held.length - 1] ?? null);
    this.syncCharge("opp", opp.buffer, opp.held[opp.held.length - 1] ?? null);
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

  /** Buffer changed → update the HUD strip. */
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
  }

  /**
   * Drive the charging-jutsu visual from the seal buffer + the live held sign.
   * The server casts Level 2 the instant its amp seal is confirmed, so the
   * 4-seal buffer never reaches us — instead, once L1 is complete we upgrade the
   * charge to its L2 look while the player is *holding* that amp seal.
   */
  private syncCharge(side: Side, buffer: string[], held: string | null): void {
    const cacheKey = `${buffer.join(",")}|${held ?? ""}`;
    if (side === "me") {
      if (cacheKey === this.myChargeKey) return;
      this.myChargeKey = cacheKey;
    } else {
      if (cacheKey === this.oppChargeKey) return;
      this.oppChargeKey = cacheKey;
    }

    let skill = skillForPrefix(buffer);
    if (!skill || skill.action !== "ATTACK" || !skill.element || buffer.length < 1) {
      this.fx.clearCharge(side);
      return;
    }
    const element = skill.element;

    let step = buffer.length;
    if (skill.level === 1 && buffer.length >= skill.seals.length && held) {
      const l2 = SKILLS.find((s) => s.element === element && s.level === 2);
      if (l2 && held === l2.seals[l2.seals.length - 1]) {
        skill = l2; // L1 done + holding the amp seal → charge the L2 form
        step = l2.seals.length;
      }
    }

    const at = side === "me" ? SPAWN.me : SPAWN.opp;
    const facing: 1 | -1 = side === "me" ? 1 : -1;
    this.fx.charge(
      side,
      {
        x: at.x,
        y: at.y - CHEST_DY,
        element,
        skillId: skill.id,
        facing,
        withGlow: (skill.level ?? 1) >= 2, // the element glow behind is Level 2 only
      },
      step,
      skill.seals.length,
    );
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
      // throw as many copies, at the size, as the charge held
      const { artSize, count } = this.fx.releaseCharge(side);
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
          artSize,
        },
        count || level,
      );
    } else {
      this.fx.clearCharge(side);
      char.pulseDefense("PROTECT");
      char.cast("NEUTRAL");
    }
  }
}
