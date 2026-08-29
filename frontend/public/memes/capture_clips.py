"""
Clip-based dataset builder for the meme hand-sign classifier.

Tracks arms + hands only (see pose_hands.py) -- no face model runs at all.
mog (flexed bicep) and dab (arm angled across the body) are ARM gestures;
hand-only landmarks structurally couldn't see them no matter how much data
you threw at them, so this also tracks the body skeleton, not just hands --
full-body movement (stand back from the camera, arms fully in frame) works
better than a hands-only close-up ever could.

Unlike a static pose snapshot, this records a short CLIP (a fixed duration
of frames, resampled to a fixed number of keyframes) per sample -- so
gestures that are fundamentally about MOTION, not shape (six_seven: hands
swapping vertical order back and forth; dab: a quick snap into an angled
pose, possibly repeated within the window) can actually be learned, using
the exact same pipeline as every other gesture instead of a special case.

The label set is NOT hardcoded here -- it's read from labels.csv (see
features.load_labels), so recording a custom dataset is just editing that
file to list your own gesture names, one per line, then running this.

Usage:
    python capture_clips.py [--camera-index N] [--clip-seconds S] [--keyframes K]

If your webcam feed looks wrong or the window closes instantly, camera
index 0 probably isn't your built-in webcam -- on macOS this often happens
when an iPhone's Continuity Camera gets grabbed as index 0 instead. Try
--camera-index 1 (or 2, ...) to find the right one.

Watch the "BODY: tracked/not tracked" indicator in the corner. If it says
"not tracked," pose data isn't being captured at all for that frame (arm
gestures like mog/dab need it) -- sit back far enough that both shoulders
are clearly in frame, make sure the room is reasonably lit, and avoid
sitting right up against a similarly-colored background.

Controls:
    Press a label's key (printed on startup, and overlaid live on each
    label's line in the window: digits 0-9 for the first ten labels, then
    a, b, c... for any beyond that) to start recording a clip of that
    gesture -- a red progress bar shows how much of the window is left.
    Perform the gesture during that window (for a swapping/motion gesture:
    repeat the motion a few times; for a snap-into-pose gesture: you can
    do it more than once within the window). The clip auto-saves at the
    end -- you don't need to hold still, and you don't need to release
    anything.
        q = quit

Aim for 30-60 clips per class, varying speed, angle, and distance between takes.
"""

import argparse
import copy
import csv
import os
import time

import cv2
import mediapipe as mp

from features import clip_to_row, frame_to_row, load_labels, pose_is_usable
from pose_hands import PoseHandsTracker, mp_hands, mp_pose

LABELS = load_labels()


def label_key(i: int) -> str:
    """0-9 for the first ten labels, then a, b, c... for any beyond that."""
    return str(i) if i < 10 else chr(ord("a") + i - 10)


KEY_TO_LABEL_ID = {ord(label_key(i)): i for i in range(len(LABELS))}

OUT_CSV = os.path.join(os.path.dirname(__file__), "clip_keypoint.csv")

mp_draw = mp.solutions.drawing_utils


def ensure_csv_exists():
    if not os.path.exists(OUT_CSV):
        with open(OUT_CSV, "w", newline="") as f:
            csv.writer(f)  # just create an empty file; no header (see train script)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera-index", type=int, default=1,
                         help="cv2.VideoCapture device index -- defaults to 1 since on this machine "
                              "index 0 grabs an iPhone Continuity Camera instead of the built-in webcam")
    parser.add_argument("--clip-seconds", type=float, default=1.5,
                         help="how long each recorded clip is")
    parser.add_argument("--keyframes", type=int, default=8,
                         help="how many evenly-spaced frames each clip is resampled to")
    args = parser.parse_args()

    ensure_csv_exists()
    # lower thresholds than the old hands-only 0.7/0.6 -- pose lock-on at
    # typical desk-webcam framing is less confident than close-up hand
    # tracking, and the visibility gate in pose_is_usable() already filters
    # out genuinely bad readings, so this doesn't trade away quality
    tracker = PoseHandsTracker(min_detection_confidence=0.5, min_tracking_confidence=0.5)
    print(f"Opening camera index {args.camera_index} (use --camera-index N to pick a different one; "
          f"run list_cameras.py if you're not sure which is your webcam)")
    cap = cv2.VideoCapture(args.camera_index)

    if not cap.isOpened() or not cap.read()[0]:
        print(f"Couldn't read from camera index {args.camera_index}. "
              f"Try a different --camera-index (0, 1, 2, ...).")
        return

    counts = {i: 0 for i in range(len(LABELS))}
    recording_label = None
    recording_started_at = 0.0
    recording_frames = []

    print("Clip-based meme hand-sign dataset capture")
    for i, label in enumerate(LABELS):
        print(f"  [{label_key(i)}] {label}")
    print("  [q] quit\n")
    print(f"Each press records a {args.clip_seconds}s clip -- perform the gesture during that window.\n")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.flip(frame, 1)
        display = copy.deepcopy(frame)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = tracker.process(rgb)

        body_tracked = pose_is_usable(res.pose_landmarks)
        has_signal = bool(body_tracked or res.left_hand_landmarks or res.right_hand_landmarks)
        if res.pose_landmarks:
            mp_draw.draw_landmarks(display, res.pose_landmarks, mp_pose.POSE_CONNECTIONS)
        if res.left_hand_landmarks:
            mp_draw.draw_landmarks(display, res.left_hand_landmarks, mp_hands.HAND_CONNECTIONS)
        if res.right_hand_landmarks:
            mp_draw.draw_landmarks(display, res.right_hand_landmarks, mp_hands.HAND_CONNECTIONS)

        h, w = display.shape[:2]
        now = time.time()

        status_color = (0, 220, 0) if body_tracked else (0, 0, 255)
        cv2.putText(display, f"BODY: {'tracked' if body_tracked else 'not tracked'}", (w - 260, 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, status_color, 2, cv2.LINE_AA)

        if recording_label is not None:
            elapsed = now - recording_started_at
            if has_signal:
                recording_frames.append(
                    frame_to_row(res.pose_landmarks, res.left_hand_landmarks, res.right_hand_landmarks, w, h)
                )

            if elapsed >= args.clip_seconds:
                if recording_frames:
                    row = clip_to_row(recording_frames, args.keyframes)
                    with open(OUT_CSV, "a", newline="") as f:
                        csv.writer(f).writerow([recording_label, *row])
                    counts[recording_label] += 1
                    print(f"Logged clip for '{LABELS[recording_label]}' "
                          f"(total: {counts[recording_label]}, frames captured: {len(recording_frames)})")
                else:
                    print(f"No pose/hands detected during that clip for '{LABELS[recording_label]}' -- discarded.")
                recording_label = None
                recording_frames = []
            else:
                frac = elapsed / args.clip_seconds
                cv2.rectangle(display, (10, h - 30), (10 + int(300 * frac), h - 10), (0, 0, 255), -1)
                cv2.rectangle(display, (10, h - 30), (310, h - 10), (200, 200, 200), 1)
                cv2.putText(display, f"RECORDING {LABELS[recording_label]}...", (10, h - 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2, cv2.LINE_AA)

        y = 25
        for i, label in enumerate(LABELS):
            cv2.putText(display, f"[{label_key(i)}] {label}: {counts[i]}", (10, y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 120), 1, cv2.LINE_AA)
            y += 20

        cv2.imshow("Meme Clip Capture", display)
        key = cv2.waitKey(1) & 0xFF

        if key == ord("q"):
            break

        if key in KEY_TO_LABEL_ID and recording_label is None:
            recording_label = KEY_TO_LABEL_ID[key]
            recording_started_at = now
            recording_frames = []

    cap.release()
    cv2.destroyAllWindows()
    print("\nDone. Clips per class:")
    for i, label in enumerate(LABELS):
        print(f"  {label}: {counts[i]}")


if __name__ == "__main__":
    main()
