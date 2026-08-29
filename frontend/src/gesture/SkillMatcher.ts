import { bus, Events } from "../core/EventBus";
import { isSeal } from "../types";

const CONFIRM_MS = 3000; // hold a sign steady this long → commit it and send to the server
const GRACE_MS = 1000; // gaps / wrong-sign blips shorter than this don't reset the countdown

/**
 * Confirms camera-detected seals. The SERVER does the sequence → jutsu matching
 * now, so this just decides *when* a seal counts: the same sign held steady for
 * CONFIRM_MS (brief dropouts under GRACE_MS forgiven). On confirm it emits
 * SEAL_CONFIRMED — NetworkClient turns that into a server input edge.
 */
export class SkillMatcher {
  private stableId: string | null = null;
  private stableSince = 0;
  private lastSeenAt = 0;
  private committedId: string | null = null;

  /** hold progress (0‥1) for the sign being formed — drives the preview ring */
  confirmProgress(now = performance.now()): number {
    if (this.stableId === null || this.stableId === this.committedId) return 0;
    return Math.min(1, (now - this.stableSince) / CONFIRM_MS);
  }

  feed(id: string | null, now = performance.now()): void {
    const sign = id && isSeal(id) ? id : null;
    const holding = this.stableId !== null;
    const withinGrace = holding && now - this.lastSeenAt < GRACE_MS;

    if (sign === this.stableId && holding) {
      this.lastSeenAt = now;
    } else if (sign === null) {
      if (!withinGrace) {
        this.stableId = null;
        this.committedId = null;
      }
    } else if (withinGrace) {
      // different sign flickered mid-hold — ignore
    } else {
      this.stableId = sign;
      this.stableSince = now;
      this.lastSeenAt = now;
      this.committedId = null;
      bus.emit(Events.MY_HELD, sign);
    }

    if (
      this.stableId !== null &&
      now - this.stableSince >= CONFIRM_MS &&
      this.committedId !== this.stableId
    ) {
      this.committedId = this.stableId;
      bus.emit(Events.SEAL_CONFIRMED, this.stableId);
    }
  }

  /** on-screen seal button — confirm immediately */
  tap(id: string): void {
    if (isSeal(id)) bus.emit(Events.SEAL_CONFIRMED, id);
  }

  reset(): void {
    this.stableId = null;
    this.lastSeenAt = 0;
    this.committedId = null;
  }
}
