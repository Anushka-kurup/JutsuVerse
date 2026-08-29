"""
Generates SYNTHETIC placeholder data for clip_keypoint.csv.

This does NOT capture real hand gestures. It procedurally builds a rough
per-frame skeleton (8-point arm/shoulder/hip pose + up to 2 hand shapes)
per class, jitters it with noise to fake sample variety, and normalizes it
exactly the way features.py does -- repeated across K_KEYFRAMES to build a
whole synthetic clip per sample, matching capture_clips.py's row format
(label + K_KEYFRAMES * 98 values: 12 pose + 42+42 hand shapes + 2
relative-hand-position values, per frame).

Most classes just hold their archetype steady across all keyframes (a
held pose, like a real clip would look for a static gesture). Two classes
are the exception:
  - six_seven: defined by the two hands' relative vertical position
    swapping back and forth, not by hand shape, so its relative-position
    values actually oscillate across the keyframes.
  - mog/dab: these are ARM gestures (flexed bicep / arm angled across the
    body) that previously had NO distinguishing signal at all under
    hands-only tracking. They now get real, distinct pose archetypes --
    this is the main thing worth checking after this change: retrain and
    see whether mog/dab actually separate now.

The one thing this generator can't fake for you is realistic timing/noise
from an actual moving body, which is exactly why real captures still matter.

Use this ONLY to sanity-check that train_classifier.py / live_predict.py
run end-to-end. A model trained on this data will NOT recognize real
gestures — replace clip_keypoint.csv with real captures from
`python capture_clips.py` before relying on the model for anything.

Usage:
    python generate_placeholder_keypoints.py
"""

import csv
import math
import os
import random

LABELS = [
    "six_seven", "mog", "thinking_monkey", "italian_hand", "korean_heart",
    "shocked_guy", "scheming_hand", "drake_no", "drake_yes", "scuba_ok", "dab",
]

OUT_CSV = os.path.join(os.path.dirname(__file__), "clip_keypoint.csv")
SAMPLES_PER_CLASS = 150
K_KEYFRAMES = 8
NOISE_STD = 0.015
MAX_ROTATION_DEG = 8

random.seed(42)


def rotate(pt, deg):
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    x, y = pt
    return (c * x - s * y, s * x + c * y)


def straight_finger(mcp, angle_deg, seg_lens=(0.24, 0.19, 0.15)):
    """MCP -> PIP -> DIP -> TIP extended straight out at angle_deg from 'up'."""
    direction = (math.sin(math.radians(angle_deg)), -math.cos(math.radians(angle_deg)))
    pts, cur = [], mcp
    for seg_len in seg_lens:
        cur = (cur[0] + direction[0] * seg_len, cur[1] + direction[1] * seg_len)
        pts.append(cur)
    return pts


def curled_finger(mcp, angle_deg, curl_deg=100, seg_lens=(0.24, 0.19, 0.15)):
    """Finger that bends back on itself (fist-style curl) after the MCP joint."""
    direction = (math.sin(math.radians(angle_deg)), -math.cos(math.radians(angle_deg)))
    pts, cur = [], mcp
    bend = 0
    for seg_len in seg_lens:
        direction = rotate(direction, bend)
        cur = (cur[0] + direction[0] * seg_len, cur[1] + direction[1] * seg_len)
        pts.append(cur)
        bend = curl_deg  # apply full curl from the second joint onward
    return pts


def build_hand(finger_specs, thumb_pts):
    """
    finger_specs: list of 4 (mcp, points[3]) for index/middle/ring/pinky, in order.
    thumb_pts: [cmc, mcp, ip, tip] (4 points).
    Returns the full 21-point list in MediaPipe order:
      0 wrist, 1-4 thumb, 5-8 index, 9-12 middle, 13-16 ring, 17-20 pinky
    """
    wrist = (0.0, 0.0)
    pts = [wrist, *thumb_pts]
    for mcp, chain in finger_specs:
        pts.append(mcp)
        pts.extend(chain)
    return pts


def mirror_x(points):
    return [(-x, y) for x, y in points]


# Pose archetypes: 6 points (left/right shoulder, elbow, wrist -- hips are
# excluded, see features.py), already authored directly in
# features.pose_to_row's own output space (relative to shoulder midpoint,
# scaled by shoulder width) since there's no real pixel frame to compute
# that from here. Order must match features.POSE_LANDMARK_IDS.
POSE_ORDER = [
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
]

# hands raised in front of the chest, roughly centered -- used by every
# gesture that's actually about hand shape, since the arms themselves
# aren't what's distinctive about those
POSE_HANDS_UP = {
    "left_shoulder": (-0.5, 0.0), "right_shoulder": (0.5, 0.0),
    "left_elbow": (-0.6, 0.9), "right_elbow": (0.6, 0.9),
    "left_wrist": (-0.3, 0.3), "right_wrist": (0.3, 0.3),
}

# right arm flexed bicep-curl style: elbow out to the side, wrist pulled up
# near the shoulder -- distinct from every other pose, unlike hands-only
# tracking where "mog" was just an arbitrary loose fist
POSE_MOG = {
    "left_shoulder": (-0.5, 0.0), "right_shoulder": (0.5, 0.0),
    "left_elbow": (-0.6, 0.9), "right_elbow": (0.75, 0.3),
    "left_wrist": (-0.65, 1.7), "right_wrist": (0.35, -0.15),
}

# right arm crossed sharply toward the opposite shoulder/face, left arm
# extended out and down diagonally -- the actual dab shape, at last
POSE_DAB = {
    "left_shoulder": (-0.5, 0.0), "right_shoulder": (0.5, 0.0),
    "left_elbow": (-0.9, -0.3), "right_elbow": (0.25, 0.15),
    "left_wrist": (-1.3, -0.7), "right_wrist": (-0.2, -0.5),
}


def pose_archetype_for(label: str):
    return {"mog": POSE_MOG, "dab": POSE_DAB}.get(label, POSE_HANDS_UP)


def archetype_for(label: str):
    """
    Return a HAND archetype for a class: either a single 21-point (x, y)
    list (one-hand gesture) or a tuple of two 21-point lists (two-hand
    gesture). The arm/pose archetype is separate -- see pose_archetype_for.
    """
    index_mcp, middle_mcp, ring_mcp, pinky_mcp = (-0.15, -0.55), (0.0, -0.6), (0.15, -0.55), (0.3, -0.5)

    def open_hand(spread=1.0, thumb_out=True):
        fingers = [
            (index_mcp, straight_finger(index_mcp, -12 * spread)),
            (middle_mcp, straight_finger(middle_mcp, 0)),
            (ring_mcp, straight_finger(ring_mcp, 10 * spread)),
            (pinky_mcp, straight_finger(pinky_mcp, 22 * spread)),
        ]
        thumb = [(-0.35, -0.05), (-0.55, -0.25), (-0.7, -0.45), (-0.85, -0.6)] if thumb_out else \
                [(-0.35, -0.05), (-0.5, -0.2), (-0.6, -0.32), (-0.68, -0.4)]
        return build_hand(fingers, thumb)

    def fist(loose=False):
        curl = 70 if loose else 105
        fingers = [
            (index_mcp, curled_finger(index_mcp, -12, curl)),
            (middle_mcp, curled_finger(middle_mcp, 0, curl)),
            (ring_mcp, curled_finger(ring_mcp, 10, curl)),
            (pinky_mcp, curled_finger(pinky_mcp, 22, curl)),
        ]
        thumb = [(-0.35, -0.05), (-0.5, -0.2), (-0.35, -0.3), (-0.15, -0.32)]
        return build_hand(fingers, thumb)

    def pinch_up():
        # all fingertips converge to one point above the palm; thumb joins them
        tip = (0.0, -0.9)
        fingers = [
            (index_mcp, [(-0.08, -0.65), (-0.03, -0.8), tip]),
            (middle_mcp, [(0.0, -0.7), (0.0, -0.85), tip]),
            (ring_mcp, [(0.05, -0.65), (0.02, -0.8), tip]),
            (pinky_mcp, [(0.12, -0.55), (0.05, -0.72), tip]),
        ]
        thumb = [(-0.35, -0.05), (-0.5, -0.3), (-0.25, -0.6), tip]
        return build_hand(fingers, thumb)

    def heart():
        # thumb + index tips touch, forming a small loop; other fingers curled
        cross_pt = (-0.1, -0.5)
        fingers = [
            (index_mcp, [(-0.25, -0.6), (-0.18, -0.55), cross_pt]),
            (middle_mcp, curled_finger(middle_mcp, 0, 100)),
            (ring_mcp, curled_finger(ring_mcp, 10, 100)),
            (pinky_mcp, curled_finger(pinky_mcp, 22, 100)),
        ]
        thumb = [(-0.35, -0.05), (-0.4, -0.25), (-0.2, -0.4), cross_pt]
        return build_hand(fingers, thumb)

    def steeple_half():
        # one hand reaching sideways with fingertips converging toward a
        # point off to the side, as if pressing against a mirrored hand
        # doing the same (Mr. Burns "excellent" pose, split across 2 hands)
        tip = (0.9, -0.55)
        fingers = [
            (index_mcp, [(0.25, -0.6), (0.55, -0.58), tip]),
            (middle_mcp, [(0.35, -0.65), (0.65, -0.6), tip]),
            (ring_mcp, [(0.45, -0.55), (0.7, -0.55), tip]),
            (pinky_mcp, [(0.55, -0.45), (0.75, -0.48), tip]),
        ]
        thumb = [(-0.35, -0.05), (-0.1, -0.2), (0.3, -0.35), (0.6, -0.45)]
        return build_hand(fingers, thumb)

    def ok_circle():
        loop = (-0.32, -0.42)
        fingers = [
            (index_mcp, [(-0.2, -0.58), (-0.28, -0.5), loop]),
            (middle_mcp, straight_finger(middle_mcp, 0)),
            (ring_mcp, straight_finger(ring_mcp, 10)),
            (pinky_mcp, straight_finger(pinky_mcp, 22)),
        ]
        thumb = [(-0.35, -0.05), (-0.45, -0.22), (-0.4, -0.35), loop]
        return build_hand(fingers, thumb)

    def thumbs_up():
        fingers = [
            (index_mcp, curled_finger(index_mcp, -12, 105)),
            (middle_mcp, curled_finger(middle_mcp, 0, 105)),
            (ring_mcp, curled_finger(ring_mcp, 10, 105)),
            (pinky_mcp, curled_finger(pinky_mcp, 22, 105)),
        ]
        thumb = [(-0.3, -0.1), (-0.35, -0.35), (-0.3, -0.6), (-0.25, -0.85)]
        return build_hand(fingers, thumb)

    def two_hands(one_hand):
        return (one_hand, mirror_x(one_hand))

    builders = {
        "six_seven": lambda: two_hands(open_hand(spread=1.0)),
        "mog": lambda: fist(loose=True),
        "thinking_monkey": lambda: fist(loose=False),
        "italian_hand": pinch_up,
        "korean_heart": heart,
        "shocked_guy": lambda: two_hands(open_hand(spread=0.5, thumb_out=False)),
        "scheming_hand": lambda: two_hands(steeple_half()),
        "drake_no": lambda: open_hand(spread=0.15, thumb_out=False),
        "drake_yes": thumbs_up,
        "scuba_ok": ok_circle,
        "dab": lambda: fist(loose=True),
    }
    return builders[label]()


def jitter(points, rng):
    angle = rng.uniform(-MAX_ROTATION_DEG, MAX_ROTATION_DEG)
    out = []
    for x, y in points:
        rx, ry = rotate((x, y), angle)
        rx += rng.gauss(0, NOISE_STD)
        ry += rng.gauss(0, NOISE_STD)
        out.append((rx, ry))
    return out


def normalize(points):
    """Wrist-relative (already true here) then scale so max abs value is 1."""
    base_x, base_y = points[0]
    relative = [(x - base_x, y - base_y) for x, y in points]
    flat = [v for pt in relative for v in pt]
    max_val = max(abs(v) for v in flat) or 1.0
    return [v / max_val for v in flat]


def relative_positions_for(label, k):
    """
    Per-keyframe (dx, dy) between the two hands' raw wrist positions (right
    minus left, matching features.frame_to_row's convention), for two-hand
    classes only. six_seven oscillates -- that's the entire signal that
    defines it. shocked_guy/scheming_hand just hold steady side by side.
    Returns None for single-hand classes (relative features stay zeroed).
    """
    if label == "six_seven":
        # two full swaps across the clip: left-high, left-high, right-high,
        # right-high, repeated -- so a rolling window can catch a crossing
        # wherever it lands in the clip
        pattern = [0.35, 0.35, -0.35, -0.35]
        return [(0.3, pattern[i % len(pattern)]) for i in range(k)]
    if label in ("shocked_guy", "scheming_hand"):
        return [(0.5, 0.0) for _ in range(k)]
    return None


def jitter_pose(pose_dict, rng, std=NOISE_STD):
    """Small independent gaussian jitter per value -- pose archetypes are
    already authored in the normalized output space, so no rotation step."""
    flat = []
    for name in POSE_ORDER:
        x, y = pose_dict[name]
        flat.append(x + rng.gauss(0, std))
        flat.append(y + rng.gauss(0, std))
    return flat


def build_clip_row(archetype, label, rng, k=K_KEYFRAMES):
    """archetype: a single 21-point hand, or a tuple of two. Returns k * 98 values."""
    hands = archetype if isinstance(archetype, tuple) else (archetype,)
    for hand_pts in hands:
        assert len(hand_pts) == 21, f"hand archetype has {len(hand_pts)} points, expected 21"

    pose_dict = pose_archetype_for(label)
    rel_positions = relative_positions_for(label, k)

    row = []
    for frame_idx in range(k):
        row.extend(jitter_pose(pose_dict, rng))

        for hand_pts in hands:
            row.extend(normalize(jitter(hand_pts, rng)))
        row.extend([0.0] * (84 - len(hands) * 42))  # pad a missing second hand's shape

        if rel_positions is not None and len(hands) == 2:
            dx, dy = rel_positions[frame_idx]
            row.append(dx + rng.gauss(0, NOISE_STD))
            row.append(dy + rng.gauss(0, NOISE_STD))
        else:
            row.extend([0.0, 0.0])
    return row


def main():
    rng = random.Random(42)
    rows = []
    for label_id, label in enumerate(LABELS):
        archetype = archetype_for(label)
        for _ in range(SAMPLES_PER_CLASS):
            row = build_clip_row(archetype, label, rng)
            rows.append([label_id, *row])

    with open(OUT_CSV, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerows(rows)

    print(f"Wrote {len(rows)} synthetic clip rows ({SAMPLES_PER_CLASS} per class, "
          f"{K_KEYFRAMES} keyframes each) to {OUT_CSV}")
    print("Reminder: this is placeholder data for pipeline testing only — it does not")
    print("represent real gestures. Run capture_clips.py for a usable model.")


if __name__ == "__main__":
    main()
