import time
from dataclasses import dataclass, field
from . import rules


@dataclass
class PlayerState:
    player_id: str
    hp: float = rules.MAX_HP
    energy: float = rules.MAX_ENERGY
    alive: bool = True

    # hold-to-confirm tracking (server-authoritative, mirrors original try_register_sign)
    current_sign: str = "UNKNOWN"
    hold_start: float = 0.0
    last_confirmed_at: float = 0.0

    # defensive effect state
    active_effect: str | None = None      # "REFLECT" | "PROTECT" | None
    effect_armed_until: float = 0.0

    reflect_uses_left: int = rules.REFLECT_MAX_USES
    protect_uses_left: int = rules.PROTECT_MAX_USES

    next_action_ready_at: float = 0.0

    def regen_energy(self, dt: float):
        if self.alive:
            self.energy = min(rules.MAX_ENERGY, self.energy + rules.ENERGY_REGEN_PER_SEC * dt)

    def effect_active(self, now: float) -> str | None:
        if self.active_effect and now < self.effect_armed_until:
            return self.active_effect
        return None

    def can_act(self, now: float) -> bool:
        return self.alive and now >= self.next_action_ready_at

    def take_damage(self, amount: float):
        self.hp = max(0.0, self.hp - amount)
        if self.hp <= 0:
            self.alive = False

    def to_public_dict(self):
        return {
            "player_id": self.player_id,
            "hp": round(self.hp, 1),
            "energy": round(self.energy, 1),
            "alive": self.alive,
            "current_sign": self.current_sign,
            "active_effect": self.active_effect,
            "reflect_uses_left": self.reflect_uses_left,
            "protect_uses_left": self.protect_uses_left,
        }


@dataclass
class Match:
    p1: PlayerState
    p2: PlayerState
    pending_attacks: list = field(default_factory=list)  # [(player_id, element, timestamp)]
    log: list = field(default_factory=list)
    winner: str | None = None

    def other(self, player_id: str) -> PlayerState:
        return self.p2 if player_id == self.p1.player_id else self.p1

    def get(self, player_id: str) -> PlayerState:
        return self.p1 if player_id == self.p1.player_id else self.p2

    def to_public_dict(self):
        return {
            "p1": self.p1.to_public_dict(),
            "p2": self.p2.to_public_dict(),
            "winner": self.winner,
            "log": self.log[-8:],
        }
