import time
from . import rules
from .state import Match, PlayerState


class GameEngine:
    """
    Owns one Match. Clients send raw classified signs (from classify_sign,
    same logic as the original script); this engine does the hold-timing,
    action resolution, and combat math server-side so no client can cheat.
    """

    def __init__(self, player1_id: str, player2_id: str):
        self.match = Match(
            p1=PlayerState(player_id=player1_id),
            p2=PlayerState(player_id=player2_id),
        )

    # ── called every time a client sends a new classified sign ──────
    def on_sign(self, player_id: str, sign: str, now: float | None = None):
        now = now or time.time()
        match = self.match
        if match.winner:
            return

        player = match.get(player_id)
        if not player.alive:
            return

        # mirror original try_register_sign hold logic, per-player
        if sign in ("UNKNOWN", ""):
            player.current_sign = "UNKNOWN"
            player.hold_start = 0.0
            return

        if sign != player.current_sign:
            player.current_sign = sign
            player.hold_start = now
            return

        held_for = now - player.hold_start
        if held_for < rules.HOLD_TIME:
            return  # still holding, not confirmed yet

        # confirmed! avoid re-firing every frame while still held
        if now - player.last_confirmed_at < rules.HOLD_TIME:
            return
        player.last_confirmed_at = now

        if not player.can_act(now):
            return

        action = rules.SIGN_ACTIONS.get(sign)
        if action is None:
            return
        action_type, element = action
        self._resolve_action(player, action_type, element, now)

    # ── resolve a confirmed action ────────────────────────────────
    def _resolve_action(self, player: PlayerState, action_type: str, element: str | None, now: float):
        match = self.match

        if action_type == "ATTACK":
            if player.energy < rules.ATTACK_ENERGY_COST:
                match.log.append(f"{player.player_id}: not enough energy to attack")
                return
            player.energy -= rules.ATTACK_ENERGY_COST
            player.next_action_ready_at = now + rules.ACTION_COOLDOWN
            match.pending_attacks.append((player.player_id, element, now))
            match.log.append(f"{player.player_id} casts {element}!")
            self._try_resolve_clash(now)
            self._resolve_single_attack(player, element, now)

        elif action_type == "REFLECT":
            if player.reflect_uses_left <= 0:
                match.log.append(f"{player.player_id}: no reflects left")
                return
            if player.energy < rules.REFLECT_ENERGY_COST:
                match.log.append(f"{player.player_id}: not enough energy to reflect")
                return
            player.energy -= rules.REFLECT_ENERGY_COST
            player.reflect_uses_left -= 1
            player.active_effect = "REFLECT"
            player.effect_armed_until = now + rules.EFFECT_ACTIVE_WINDOW
            player.next_action_ready_at = now + rules.ACTION_COOLDOWN
            match.log.append(f"{player.player_id} readies REFLECT ({player.reflect_uses_left} left)")

        elif action_type == "PROTECT":
            if player.protect_uses_left <= 0:
                match.log.append(f"{player.player_id}: no protects left")
                return
            if player.energy < rules.PROTECT_ENERGY_COST:
                match.log.append(f"{player.player_id}: not enough energy to protect")
                return
            player.energy -= rules.PROTECT_ENERGY_COST
            player.protect_uses_left -= 1
            player.active_effect = "PROTECT"
            player.effect_armed_until = now + rules.EFFECT_ACTIVE_WINDOW
            player.next_action_ready_at = now + rules.ACTION_COOLDOWN
            match.log.append(f"{player.player_id} readies PROTECT ({player.protect_uses_left} left)")

    # ── if both players attacked within CLASH_WINDOW, type chart decides ──
    def _try_resolve_clash(self, now: float):
        match = self.match
        recent = [a for a in match.pending_attacks if now - a[2] <= rules.CLASH_WINDOW]
        if len(recent) < 2:
            return
        # take the two most recent from different players
        by_player = {}
        for pid, element, t in reversed(recent):
            by_player.setdefault(pid, (element, t))
        if len(by_player) < 2:
            return

        (pid_a, (elem_a, _)), (pid_b, (elem_b, _)) = list(by_player.items())[:2]
        player_a, player_b = match.get(pid_a), match.get(pid_b)

        if elem_a == elem_b:
            match.log.append(f"CLASH! {elem_a} vs {elem_b} - cancel out")
        elif rules.BEATS.get(elem_a) == elem_b:
            match.log.append(f"CLASH! {elem_a} beats {elem_b} - {pid_b} takes bonus damage")
            self._apply_damage(player_b, rules.BASE_DAMAGE // 2, attacker=player_a)
        elif rules.BEATS.get(elem_b) == elem_a:
            match.log.append(f"CLASH! {elem_b} beats {elem_a} - {pid_a} takes bonus damage")
            self._apply_damage(player_a, rules.BASE_DAMAGE // 2, attacker=player_b)

        match.pending_attacks = [a for a in match.pending_attacks if now - a[2] > rules.CLASH_WINDOW]

    # ── a single attack always tries to land on the opponent too ──────
    def _resolve_single_attack(self, attacker: PlayerState, element: str, now: float):
        defender = self.match.other(attacker.player_id)
        self._apply_damage(defender, rules.BASE_DAMAGE, attacker=attacker)

    # ── damage application respecting PROTECT / REFLECT ────────────
    def _apply_damage(self, defender: PlayerState, amount: float, attacker: PlayerState):
        now = time.time()
        effect = defender.effect_active(now)

        if effect == "PROTECT":
            self.match.log.append(f"{defender.player_id} PROTECTED - no damage taken")
            defender.active_effect = None
            return

        if effect == "REFLECT":
            self.match.log.append(f"{defender.player_id} REFLECTED damage back at {attacker.player_id}!")
            defender.active_effect = None
            attacker.take_damage(amount)
            if not attacker.alive:
                self.match.winner = defender.player_id
                self.match.log.append(f"{defender.player_id} WINS!")
            return

        defender.take_damage(amount)
        if not defender.alive:
            self.match.winner = attacker.player_id
            self.match.log.append(f"{attacker.player_id} WINS!")

    # ── called on a fixed tick (e.g. every 100ms) for passive updates ──
    def tick(self, dt: float):
        now = time.time()
        for p in (self.match.p1, self.match.p2):
            p.regen_energy(dt)
            if p.active_effect and now >= p.effect_armed_until:
                p.active_effect = None
