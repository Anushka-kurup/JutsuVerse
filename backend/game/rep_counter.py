"""
Rep counting for the 6-7 minigame.

Direct port of frontend/src/lab/counter.ts. The browser measures, the server
counts: clients stream the normalised height difference `d` and this decides
what is actually a rep, the same way GameEngine owns hold timing rather than
trusting the client's own sense of when a sign was held.

Keep the constants here in sync with counter.ts. They are not guesses - they
were swept against three recorded 20-rep trials, and every value in the range
enter 0.2..1.0 reproduced the true count, so 0.6 sits mid-plateau.
"""

ENTER = 0.6          # hand spans: cross this to claim a side
EXIT = 0.25          # fall back inside this to release it
MIN_FLIP_MS = 120    # floor between counted reps

A_HIGH = "A_HIGH"
B_HIGH = "B_HIGH"
NEUTRAL = "NEUTRAL"


class RepCounter:
    """
    Hysteresis is what makes this trustworthy: with separate enter/exit
    thresholds a hand cannot register a flip without crossing the whole band,
    so small fast jitter can never be farmed into reps.

    One rep = one confirmed alternation, so a full cycle counts twice.
    """

    def __init__(self):
        self.pose = NEUTRAL
        self.reps = 0
        self.last_side = None
        self.last_flip_at = float("-inf")

    def on_signal(self, d: float, t_ms: float) -> bool:
        """Feed one measurement. Returns True if this frame completed a rep."""
        if self.pose == A_HIGH and d < EXIT:
            self.pose = NEUTRAL
        elif self.pose == B_HIGH and d > -EXIT:
            self.pose = NEUTRAL

        if self.pose != NEUTRAL:
            return False

        side = A_HIGH if d > ENTER else (B_HIGH if d < -ENTER else None)
        if side is None or t_ms - self.last_flip_at < MIN_FLIP_MS:
            return False

        self.pose = side
        self.last_flip_at = t_ms
        scored = self.last_side is not None and self.last_side != side
        self.last_side = side
        if scored:
            self.reps += 1
        return scored

    def reset(self):
        self.__init__()
