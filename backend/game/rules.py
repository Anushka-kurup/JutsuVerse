"""
Game balance constants and the sign -> action mapping.
Reuses the seal names from the original classify_sign() function:
TIGER/SNAKE/BIRD become attack elements; RAM/BOAR become defensive actions.
"""

# sign -> (action_type, element_or_None)
SIGN_ACTIONS = {
    "TIGER": ("ATTACK", "FIRE"),
    "SNAKE": ("ATTACK", "WATER"),
    "BIRD":  ("ATTACK", "WIND"),
    "RAM":   ("REFLECT", None),
    "BOAR":  ("PROTECT", None),
}

# element X beats element Y (only matters during a clash - see engine.py)
BEATS = {
    "FIRE":  "WIND",
    "WIND":  "WATER",
    "WATER": "FIRE",
}

HOLD_TIME = 1.0          # seconds to hold a sign before the action fires
CLASH_WINDOW = 0.5       # if both players attack within this window, it's a clash

MAX_HP = 100
MAX_ENERGY = 100
ENERGY_REGEN_PER_SEC = 8

ATTACK_ENERGY_COST  = 20
REFLECT_ENERGY_COST = 30
PROTECT_ENERGY_COST = 20

REFLECT_MAX_USES = 2
PROTECT_MAX_USES = 3

BASE_DAMAGE = 15
EFFECT_ACTIVE_WINDOW = 1.2   # seconds a REFLECT/PROTECT stays "armed" after activation
ACTION_COOLDOWN = 0.4        # seconds before you can act again after any action
