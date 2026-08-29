"""
Guards rep_counter.py against drifting from frontend/src/lab/counter.ts.

The same logic lives in both languages, so the risk is that someone retunes one
and forgets the other. These fixtures are the signal from three real 20-rep
trials; if the counts move, the two implementations have diverged.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from game.rep_counter import RepCounter, ENTER, EXIT, MIN_FLIP_MS

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "six_seven_trials.json"


def _count(signal):
    c = RepCounter()
    for t, d in signal:
        c.on_signal(d, t)
    return c.reps


def test_matches_recorded_trials():
    for trial in json.load(FIXTURES.open())["trials"]:
        got = _count(trial["signal"])
        assert got == trial["expected_reps"], (
            f"{trial['name']}: counted {got}, expected {trial['expected_reps']} "
            f"(performer actually did {trial['performed']})"
        )


def test_constants_match_the_tuned_plateau():
    # Sweeping showed enter 0.2..1.0 all reproduce the true count. If someone
    # moves ENTER outside that, counts start drifting on real input.
    assert 0.2 <= ENTER <= 1.0
    assert 0 < EXIT < ENTER          # hysteresis, or jitter can be farmed
    assert 0 < MIN_FLIP_MS <= 250    # 350ms was shown to drop real reps


def test_jitter_cannot_be_farmed():
    # Vibrating inside the band must never score, however long it goes on.
    c = RepCounter()
    for i in range(400):
        c.on_signal(EXIT * 0.9 * (1 if i % 2 else -1), i * 33)
    assert c.reps == 0


def test_one_way_motion_does_not_score():
    # Holding one hand high is not a rep; only alternation is.
    c = RepCounter()
    for i in range(200):
        c.on_signal(3.0, i * 33)
    assert c.reps == 0


if __name__ == "__main__":
    # Runs without pytest: python tests/test_rep_counter.py
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS  {name}")
            except AssertionError as e:
                failed += 1
                print(f"  FAIL  {name}\n        {e}")
    print("all passed" if not failed else f"{failed} failed")
    sys.exit(1 if failed else 0)
