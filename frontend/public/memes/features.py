"""
Shared landmark feature extraction, used by capture_clips.py and
live_predict.py. Built on pose_hands.PoseHandsTracker (body pose + both
hands, no face model at all -- see pose_hands.py), not just hand landmarks --
gestures like mog (flexed bicep) and dab (arm angled across the body) are
defined by ARM position, which hand-only landmarks never carried any
information about, no matter how much training data you threw at them.

Also defines the gesture label list, shared with capture_clips.py and
train_classifier.py: labels.csv is the one place a custom dataset's label
set is defined, and everything else reads it from here.

Two layers:
  - per-frame: pose gives 6 selected landmarks (shoulders/elbows/wrists)
    made relative to the shoulder midpoint and scaled by shoulder width
    (12 values) -- this is what lets the classifier see arm angle. Hips
    are deliberately excluded: at normal desk-webcam framing (person
    sitting, camera at face/chest height) hips are usually out of frame or
    only estimated with low confidence, so including them just injects
    noise for zero benefit -- none of these 11 gestures need hip position.
    Pose is also gated on shoulder VISIBILITY (MediaPipe's own confidence
    that a landmark is actually seen, not guessed) -- if the shoulders
    aren't reliably visible, pose is treated as not-detected rather than
    silently normalizing against a hallucinated reference frame.
    Each hand (if seen) contributes its own 42-value wrist-relative,
    scale-normalized shape vector, same technique as before, for gestures
    that are actually about hand shape. Plus 2 relative-position values
    between the two wrists, which is what six_seven is actually defined by.
  - per-clip: a variable-length sequence of per-frame vectors (captured
    over ~1-2 seconds) is resampled to a fixed number of evenly-spaced
    keyframes and flattened into one fixed-length row, so gestures that
    are fundamentally about MOTION carry that motion into the feature
    vector instead of being reduced to one freeze-frame.
"""

import csv
import itertools
import os

LABELS_CSV = os.path.join(os.path.dirname(__file__), "labels.csv")


def load_labels():
    """The gesture label set, one per line in labels.csv, in class-id order.
    Edit this file to point the whole pipeline (capture, train, predict) at
    a custom set of gestures -- nothing else hardcodes the label list."""
    with open(LABELS_CSV) as f:
        return [row[0] for row in csv.reader(f) if row]


# MediaPipe Pose landmark indices for the arm/shoulder skeleton --
# https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
POSE_LANDMARK_IDS = {
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_elbow": 13,
    "right_elbow": 14,
    "left_wrist": 15,
    "right_wrist": 16,
}

MIN_SHOULDER_VISIBILITY = 0.5

HAND_FEATURE_LEN = 42
POSE_FEATURE_LEN = len(POSE_LANDMARK_IDS) * 2  # 12
NUM_RELATIVE_FEATURES = 2  # dx, dy between the two wrists
PER_FRAME_FEATURE_LEN = POSE_FEATURE_LEN + HAND_FEATURE_LEN * 2 + NUM_RELATIVE_FEATURES  # 98


def pose_is_usable(pose_landmarks):
    """Only trust a pose reading if both shoulders (the reference frame
    everything else is normalized against) are actually visible, not just
    estimated from context by MediaPipe's temporal smoothing."""
    if not pose_landmarks:
        return False
    l_vis = pose_landmarks.landmark[POSE_LANDMARK_IDS["left_shoulder"]].visibility
    r_vis = pose_landmarks.landmark[POSE_LANDMARK_IDS["right_shoulder"]].visibility
    return l_vis >= MIN_SHOULDER_VISIBILITY and r_vis >= MIN_SHOULDER_VISIBILITY


def landmarks_to_row(hand_landmarks, image_width, image_height):
    """Convert one hand's 21 MediaPipe landmarks to a flat, normalized 42-value row.

    Steps (matches the reference project):
      1. Convert normalized (0-1) coords to pixel coords.
      2. Make coordinates relative to the wrist (landmark 0).
      3. Flatten to [x1,y1,x2,y2,...].
      4. Scale so the max absolute value is 1 (position/scale invariant).
    """
    points = [(lm.x * image_width, lm.y * image_height) for lm in hand_landmarks.landmark]

    base_x, base_y = points[0]
    relative = [(x - base_x, y - base_y) for x, y in points]

    flat = list(itertools.chain.from_iterable(relative))
    max_val = max(abs(v) for v in flat) or 1.0
    return [v / max_val for v in flat]


def pose_to_row(pose_landmarks, image_width, image_height):
    """
    6 selected landmarks (shoulders, elbows, wrists), made relative to the
    shoulder midpoint and scaled by shoulder width, so the resulting 12
    values capture arm position/angle invariant to how far the person is
    from the camera or where they stand in frame -- this is the piece that
    was completely missing before, and is what mog/dab actually need.
    Caller should check pose_is_usable() first.
    """
    pts = {
        name: (pose_landmarks.landmark[idx].x * image_width, pose_landmarks.landmark[idx].y * image_height)
        for name, idx in POSE_LANDMARK_IDS.items()
    }

    l_shoulder, r_shoulder = pts["left_shoulder"], pts["right_shoulder"]
    center_x = (l_shoulder[0] + r_shoulder[0]) / 2
    center_y = (l_shoulder[1] + r_shoulder[1]) / 2
    shoulder_width = max(abs(l_shoulder[0] - r_shoulder[0]), 1e-6)

    flat = []
    for name in POSE_LANDMARK_IDS:
        x, y = pts[name]
        flat.append((x - center_x) / shoulder_width)
        flat.append((y - center_y) / shoulder_width)
    return flat


def frame_to_row(pose_landmarks, left_hand_landmarks, right_hand_landmarks, image_width, image_height):
    """
    Build a 98-value row for ONE frame from MediaPipe Holistic's results:
      - 12 values: arm/shoulder pose (zeroed if pose isn't usable -- see
        pose_is_usable()).
      - 42 values: left hand shape, wrist-relative (zeroed if not seen).
      - 42 values: right hand shape, same (zeroed if not seen).
      - 2 values: raw relative position between the two wrists (right minus
        left, in image-normalized 0-1 coords, NOT per-hand normalized) --
        falls back to the pose's own wrist landmarks if hand-tracking missed
        a hand but the pose skeleton still has it (e.g. a fist is harder for
        the hand model to lock onto than an open palm, but pose usually
        still sees the arm). This is the signal six_seven is defined by.

    left_hand_landmarks/right_hand_landmarks use Holistic's own anatomical
    left/right classification, which stays consistent even if the hands
    cross over during a motion -- unlike sorting by x-position, which would
    flip exactly when hands swap sides.
    """
    usable_pose = pose_is_usable(pose_landmarks)

    row = []
    row.extend(pose_to_row(pose_landmarks, image_width, image_height) if usable_pose else [0.0] * POSE_FEATURE_LEN)
    row.extend(landmarks_to_row(left_hand_landmarks, image_width, image_height) if left_hand_landmarks else [0.0] * HAND_FEATURE_LEN)
    row.extend(landmarks_to_row(right_hand_landmarks, image_width, image_height) if right_hand_landmarks else [0.0] * HAND_FEATURE_LEN)

    if left_hand_landmarks and right_hand_landmarks:
        row.append(right_hand_landmarks.landmark[0].x - left_hand_landmarks.landmark[0].x)
        row.append(right_hand_landmarks.landmark[0].y - left_hand_landmarks.landmark[0].y)
    elif usable_pose:
        lw = pose_landmarks.landmark[POSE_LANDMARK_IDS["left_wrist"]]
        rw = pose_landmarks.landmark[POSE_LANDMARK_IDS["right_wrist"]]
        row.append(rw.x - lw.x)
        row.append(rw.y - lw.y)
    else:
        row.extend([0.0, 0.0])

    return row


def resample_indices(n_available, k):
    """k evenly-spaced indices into a sequence of n_available items (repeats if n_available < k)."""
    if n_available <= 0:
        return []
    if n_available == 1:
        return [0] * k
    return [round(i * (n_available - 1) / (k - 1)) for i in range(k)]


def clip_to_row(frame_features, k):
    """
    frame_features: a list of 98-value per-frame vectors captured over a
    clip (only frames where pose or a hand was detected). Resamples to
    exactly k evenly-spaced keyframes and flattens into one k*98-value
    row, so the row length is fixed regardless of how long the clip was.
    """
    indices = resample_indices(len(frame_features), k)
    row = []
    for i in indices:
        row.extend(frame_features[i])
    return row
