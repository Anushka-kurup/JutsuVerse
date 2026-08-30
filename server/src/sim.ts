import {
  MAX_HP,
  MAX_SHIELDS,
  SHIELD_MAX_TICKS,
  TICK_HZ,
  type Edge,
  type FighterPublic,
  type Sign,
  type Stance,
} from "@jutsu/protocol";
import {
  ATTACKS,
  attackById,
  consumeSuffix,
  matchAttack,
  matchesShield,
  pruneBuffer,
  SHIELD,
  type AttackCommand,
  type BufferEvent,
} from "./commands.ts";
import { MAX_SEAL_SEQUENCE } from "../../shared/skills.ts";

/** Seal you must keep held to sustain the shield (last seal of the shield sequence). */
const SHIELD_HOLD_SIGN: Sign = SHIELD.seq[SHIELD.seq.length - 1];

const BUFFER_TICKS = TICK_HZ * 40;
// pruning keeps the buffer a live skill prefix, so it can never exceed the
// longest sequence anyway — this is just a hard safety cap.
const MAX_BUFFERED_SIGNS = MAX_SEAL_SEQUENCE;
const LEVEL_FINALIZE_TICKS = TICK_HZ;
const HITSTUN_TICKS = 6;

interface AttackCandidate {
  commandId: string;
  readyAtTick: number;
}

export interface Fighter {
  hp: number;
  shields: number;
  stance: Stance;
  moveId: string | null;
  lastSkill: string | null;
  lastSkillTick: number;
  stanceUntilTick: number;
  currentHold: Sign | null;
  shieldUntilTick: number;
  /** After a timed-out shield, block a recast until the hold is released. */
  shieldLock: boolean;
  buffer: BufferEvent[];
  candidate: AttackCandidate | null;
}

export interface FighterStep {
  fighter: Fighter;
  attack: AttackCommand | null;
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
    currentHold: null,
    shieldUntilTick: 0,
    shieldLock: false,
    buffer: [],
    candidate: null,
  };
}

/** A confirmed seal is represented by the down edge; up only closes the input edge. */
export function applyEdge(f: Fighter, sign: Sign, edge: Edge, tick: number): Fighter {
  if (edge === "up") return f;
  if (f.buffer[f.buffer.length - 1]?.sign === sign) return f;
  const grown = pruneBuffer([...f.buffer, { sign, tick }]);
  return { ...f, buffer: grown.slice(-MAX_BUFFERED_SIGNS) };
}

/** Live recognized gesture, separate from confirmed sequence input. */
export function applyHold(f: Fighter, sign: Sign | null): Fighter {
  return { ...f, currentHold: sign };
}

export function stepFighter(f: Fighter, tick: number, canAttack = true): FighterStep {
  let next: Fighter = {
    ...f,
    buffer: f.buffer.filter((event) => tick - event.tick <= BUFFER_TICKS),
  };

  if (next.currentHold !== SHIELD_HOLD_SIGN) {
    next = { ...next, shieldLock: false };
  }

  if (next.stance === "hitstun" && tick >= next.stanceUntilTick) {
    next = { ...next, stance: "idle", moveId: null, stanceUntilTick: 0 };
  } else if (next.stance === "startup" && tick >= next.stanceUntilTick) {
    next = { ...next, stance: "recover", stanceUntilTick: tick + 5 };
  } else if (next.stance === "recover" && tick >= next.stanceUntilTick) {
    next = { ...next, stance: "idle", moveId: null, stanceUntilTick: 0 };
  }

  if (next.stance === "block") {
    const holdLost = next.currentHold !== SHIELD_HOLD_SIGN;
    const timedOut = tick >= next.shieldUntilTick;
    if (holdLost || timedOut) {
      next = {
        ...next,
        stance: "idle",
        moveId: null,
        shieldUntilTick: 0,
        shieldLock: timedOut && !holdLost,
      };
      if (timedOut && !holdLost) return { fighter: next, attack: null };
    } else {
      return { fighter: next, attack: null };
    }
  }

  if (
    !next.shieldLock &&
    next.shields > 0 &&
    next.currentHold === SHIELD_HOLD_SIGN &&
    matchesShield(next.buffer)
  ) {
    next = {
      ...next,
      shields: next.shields - 1,
      shieldLock: false,
      stance: "block",
      moveId: SHIELD.id,
      lastSkill: SHIELD.id,
      lastSkillTick: tick,
      shieldUntilTick: tick + SHIELD_MAX_TICKS,
      buffer: consumeSuffix(next.buffer, SHIELD.seq.length),
      candidate: null,
    };
    return { fighter: next, attack: null };
  }

  if (next.stance !== "idle") return { fighter: next, attack: null };

  if (!canAttack) {
    return { fighter: next, attack: null };
  }

  const command = matchAttack(next.buffer);
  if (!command) {
    return { fighter: { ...next, candidate: null }, attack: null };
  }

  // Level 1 is a prefix of Level 2. Give the player enough time to confirm the
  // next camera sign; Level 2 is unambiguous and fires now.
  if (command.level < 2) {
    if (next.candidate?.commandId !== command.id) {
      return {
        fighter: {
          ...next,
          candidate: {
            commandId: command.id,
            readyAtTick: tick + LEVEL_FINALIZE_TICKS,
          },
        },
        attack: null,
      };
    }
    if (tick < next.candidate.readyAtTick) {
      return { fighter: next, attack: null };
    }
    const stronger = ATTACKS.find(
      (candidate) =>
        candidate.element === command.element && candidate.level === command.level + 1,
    );
    const extensionSign = stronger?.seq[command.seq.length];
    if (extensionSign && next.currentHold === extensionSign) {
      return {
        fighter: {
          ...next,
          candidate: { ...next.candidate, readyAtTick: tick + 1 },
        },
        attack: null,
      };
    }
  }

  return castAttack(next, command, tick);
}

function castAttack(f: Fighter, command: AttackCommand, tick: number): FighterStep {
  return {
    fighter: {
      ...f,
      stance: "startup",
      moveId: command.id,
      lastSkill: command.id,
      lastSkillTick: tick,
      stanceUntilTick: tick + 6,
      buffer: consumeSuffix(f.buffer, command.seq.length),
      candidate: null,
    },
    attack: command,
  };
}

export function blockAttack(f: Fighter): Fighter {
  return {
    ...f,
    stance: "idle",
    moveId: null,
    shieldUntilTick: 0,
    shieldLock: false,
  };
}

/**
 * Restore HP for a contest reward (6-7 or meme race). Capped at MAX_HP, but a
 * fighter already above it (the memegate bonus can start someone at 35) keeps
 * what they have — a heal never lowers HP.
 */
export function heal(f: Fighter, amount: number): Fighter {
  return { ...f, hp: Math.min(Math.max(f.hp, MAX_HP), f.hp + amount) };
}

/**
 * Drop everything transient — stance, seal buffer, live hold, shield timer —
 * while keeping HP and remaining shields. Used when the 6-7 contest freezes
 * combat, so nothing half-formed survives the interruption.
 */
export function calmFighter(f: Fighter): Fighter {
  return {
    ...f,
    stance: "idle",
    moveId: null,
    stanceUntilTick: 0,
    currentHold: null,
    shieldUntilTick: 0,
    buffer: [],
    candidate: null,
  };
}

export function takeDamage(
  f: Fighter,
  tick: number,
  damage: number,
  clearBuffer = false,
): Fighter {
  return {
    ...f,
    hp: Math.max(0, f.hp - damage),
    stance: damage > 0 ? "hitstun" : f.stance,
    moveId: damage > 0 ? null : f.moveId,
    stanceUntilTick: damage > 0 ? tick + HITSTUN_TICKS : f.stanceUntilTick,
    shieldUntilTick: damage > 0 ? 0 : f.shieldUntilTick,
    buffer: clearBuffer ? [] : f.buffer,
    candidate: clearBuffer ? null : f.candidate,
  };
}

export function toPublic(f: Fighter, tick: number): FighterPublic {
  return {
    hp: f.hp,
    shields: f.shields,
    stance: f.stance,
    moveId: f.moveId,
    lastSkill: f.lastSkill,
    lastSkillTick: f.lastSkillTick,
    buffer: f.buffer.map((event) => event.sign),
    held: f.currentHold ? [f.currentHold] : [],
    guardLeft: f.stance === "block" ? Math.max(0, f.shieldUntilTick - tick) : 0,
    shieldActive: f.stance === "block",
  };
}

export function commandFor(id: string): AttackCommand | undefined {
  return attackById(id);
}
