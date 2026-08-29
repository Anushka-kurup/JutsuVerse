import {
  MAX_HP,
  MAX_SHIELDS,
  type Edge,
  type FighterPublic,
  type Sign,
  type Stance,
} from "@jutsu/protocol";
import {
  commandById,
  consumeSuffix,
  matchBuffer,
  type BufferEvent,
  type Command,
} from "./commands.ts";

export const STARTUP_TICKS = 7;
export const ACTIVE_TICKS = 3;
export const RECOVER_TICKS = 5;
export const HITSTUN_TICKS = 6;
export const BUFFER_TICKS = 700; // ~35 s at 20 Hz — long enough for camera-paced seal combos
export const GUARD_TICKS = 40;

export interface Fighter {
  hp: number;
  shields: number;
  stance: Stance;
  moveId: string | null;
  lastSkill: string | null;
  lastSkillTick: number;
  stanceUntilTick: number;
  activeFromTick: number;
  attackDamage: number;
  held: Sign[];
  buffer: BufferEvent[];
}

export function createFighter(): Fighter {
  return {
    hp: MAX_HP,
    shields: MAX_SHIELDS,
    stance: "idle",
    moveId: null,
    lastSkill: null,
    lastSkillTick: -1,
    stanceUntilTick: 0,
    activeFromTick: -1,
    attackDamage: 0,
    held: [],
    buffer: [],
  };
}

export function applyEdge(
  f: Fighter,
  sign: Sign,
  edge: Edge,
  tick: number,
): Fighter {
  const held = new Set(f.held);
  let buffer = f.buffer;
  if (edge === "down") {
    if (!held.has(sign)) {
      held.add(sign);
      buffer = [...buffer, { sign, tick }];
    }
  } else {
    held.delete(sign);
  }
  return { ...f, held: [...held], buffer };
}

function timings(moveId: string | null): Command | undefined {
  return moveId ? commandById(moveId) : undefined;
}

export function stepFighter(f: Fighter, tick: number): Fighter {
  let next: Fighter = {
    ...f,
    held: [...f.held],
    buffer: f.buffer.filter((e) => tick - e.tick <= BUFFER_TICKS),
  };

  if (next.stance === "startup" && tick >= next.stanceUntilTick) {
    const move = timings(next.moveId);
    const active = move?.activeTicks ?? ACTIVE_TICKS;
    next = {
      ...next,
      stance: "active",
      stanceUntilTick: tick + active,
      activeFromTick: tick,
    };
  } else if (next.stance === "active" && tick >= next.stanceUntilTick) {
    const move = timings(next.moveId);
    const recover = move?.recoverTicks ?? RECOVER_TICKS;
    next = {
      ...next,
      stance: "recover",
      stanceUntilTick: tick + recover,
      activeFromTick: -1,
    };
  } else if (next.stance === "recover" && tick >= next.stanceUntilTick) {
    next = {
      ...next,
      stance: "idle",
      moveId: null,
      stanceUntilTick: 0,
      attackDamage: 0,
    };
  } else if (next.stance === "hitstun" && tick >= next.stanceUntilTick) {
    next = {
      ...next,
      stance: "idle",
      moveId: null,
      stanceUntilTick: 0,
      attackDamage: 0,
    };
  } else if (next.stance === "block" && tick >= next.stanceUntilTick) {
    next = {
      ...next,
      stance: "idle",
      moveId: null,
      stanceUntilTick: 0,
      attackDamage: 0,
    };
  }

  if (next.stance === "idle" || next.stance === "startup") {
    const cmd = matchBuffer(next.buffer, tick);
    if (cmd?.move === "guard") {
      next = {
        ...next,
        stance: "block",
        moveId: cmd.id,
        lastSkill: cmd.id,
        lastSkillTick: tick,
        stanceUntilTick: tick + cmd.guardTicks,
        activeFromTick: -1,
        attackDamage: 0,
        buffer: consumeSuffix(next.buffer, cmd.seq.length),
      };
    } else if (cmd?.move === "attack" && next.stance === "idle") {
      next = {
        ...next,
        stance: "startup",
        moveId: cmd.id,
        lastSkill: cmd.id,
        lastSkillTick: tick,
        stanceUntilTick: tick + cmd.startupTicks,
        attackDamage: cmd.damage,
        buffer: consumeSuffix(next.buffer, cmd.seq.length),
      };
    }
  }

  return next;
}

export function guardedDamage(raw: number): number {
  return Math.max(1, Math.floor(raw / 2));
}

export function takeHit(f: Fighter, tick: number, damage: number): Fighter {
  return {
    ...f,
    hp: Math.max(0, f.hp - damage),
    stance: "hitstun",
    moveId: null,
    stanceUntilTick: tick + HITSTUN_TICKS,
    activeFromTick: -1,
    attackDamage: 0,
  };
}

/** Hits fire on the first active tick of a move, not every active tick. */
export function resolveHits(
  a: Fighter,
  b: Fighter,
  tick: number,
): { a: Fighter; b: Fighter } {
  let nextA = a;
  let nextB = b;
  const aStrike = a.stance === "active" && a.activeFromTick === tick;
  const bStrike = b.stance === "active" && b.activeFromTick === tick;
  const aDmg = a.attackDamage || 2;
  const bDmg = b.attackDamage || 2;

  if (aStrike && b.stance !== "hitstun") {
    if (b.stance === "block") {
      nextB = { ...b, hp: Math.max(0, b.hp - guardedDamage(aDmg)) };
    } else if (b.shields > 0) {
      nextB = takeHit({ ...b, shields: b.shields - 1 }, tick, 0);
    } else {
      nextB = takeHit(b, tick, aDmg);
    }
  }
  if (bStrike && nextA.stance !== "hitstun") {
    if (nextA.stance === "block") {
      nextA = { ...nextA, hp: Math.max(0, nextA.hp - guardedDamage(bDmg)) };
    } else if (nextA.shields > 0) {
      nextA = takeHit({ ...nextA, shields: nextA.shields - 1 }, tick, 0);
    } else {
      nextA = takeHit(nextA, tick, bDmg);
    }
  }
  return { a: nextA, b: nextB };
}

export function toPublic(f: Fighter, tick: number): FighterPublic {
  return {
    hp: Math.round(f.hp),
    shields: f.shields,
    stance: f.stance,
    moveId: f.moveId,
    lastSkill: f.lastSkill,
    lastSkillTick: f.lastSkillTick,
    buffer: f.buffer.map((e) => e.sign).slice(-6),
    held: [...f.held],
    guardLeft: f.stance === "block" ? Math.max(0, f.stanceUntilTick - tick) : 0,
  };
}
