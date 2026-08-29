"""
Live webcam preview using the trained clip classifier from train_classifier.py.

Tracks arms + hands only (see pose_hands.py), matching capture_clips.py --
no face model runs at all. Arm position is real signal here, not just hand
shape, so mog/dab get a fair shot at being recognized instead of being
structurally invisible.

Classifies the WHOLE clip of your current gesture attempt continuously as
it happens: it starts predicting from the very first frame of signal (no
artificial delay), using every frame accumulated so far, and the window
keeps growing up to --clip-seconds (matching how capture_clips.py builds
training clips) so a fast motion like six_seven or dab is judged on its
full arc, not a freeze-frame. Predictions get more confident as more of
the clip fills in. A brief pause with no hand/body signal (0.3s) starts a
fresh clip for the next attempt, so two gestures done back-to-back don't
blend into one confused prediction.

Usage:
    python live_predict.py [--camera-index N] [--min-confidence P]
                            [--clip-seconds S] [--keyframes K] [--target LABEL]

If the window closes instantly or shows a black feed, camera index 0
probably isn't your built-in webcam -- on macOS this often happens when an
iPhone's Continuity Camera gets grabbed as index 0 instead. Try
--camera-index 1 (or 2, ...) to find the right one.

Watch the "BODY: tracked/not tracked" indicator in the corner. If it says
"not tracked," arm gestures like mog/dab have zero signal for that frame --
sit back far enough that both shoulders are clearly in frame.

--target LABEL simulates the actual game's win condition for solo testing:
the moment that gesture is confidently recognized, it flashes "RECOGNIZED!"
with the elapsed time, exactly like what makes a player win a round. Press
'r' to reset the timer and try again. Without --target this is just a live
recognition-quality display (current prediction + confidence).

six_seven still gets its own dedicated crossing-detector display at the
bottom of the window: a window classifier can tell "this looks like a
six_seven-shaped motion" but the crossing-detector is the more reliable
signal for exactly when a swap happens, since it's rule-based, not learned.
"""

import argparse
import os
import time
from collections import deque

import cv2
import joblib
import mediapipe as mp

from features import clip_to_row, frame_to_row, pose_is_usable
from pose_hands import PoseHandsTracker, mp_hands, mp_pose

MODEL_PATH = os.path.join(os.path.dirname(__file__), "meme_sign_model.pkl")
SIX_SEVEN_MARGIN = 0.05  # normalized image-height units of vertical separation required to call a side "higher"
NO_SIGNAL_RESET_SEC = 0.3  # brief gap before starting a fresh clip -- tolerates momentary tracking flicker mid-motion

mp_draw = mp.solutions.drawing_utils


def wrist_heights(pose_landmarks, left_hand_landmarks, right_hand_landmarks):
    """(left_y, right_y) using hand landmarks when available (averaged, smoother),
    falling back to the pose skeleton's wrists otherwise. None if neither is available."""
    if left_hand_landmarks and right_hand_landmarks:
        left_y = sum(lm.y for lm in left_hand_landmarks.landmark) / len(left_hand_landmarks.landmark)
        right_y = sum(lm.y for lm in right_hand_landmarks.landmark) / len(right_hand_landmarks.landmark)
        return left_y, right_y
    if pose_is_usable(pose_landmarks):
        from features import POSE_LANDMARK_IDS
        left_y = pose_landmarks.landmark[POSE_LANDMARK_IDS["left_wrist"]].y
        right_y = pose_landmarks.landmark[POSE_LANDMARK_IDS["right_wrist"]].y
        return left_y, right_y
    return None


def six_seven_order(pose_landmarks, left_hand_landmarks, right_hand_landmarks):
    """
    True if the left hand/wrist is clearly higher, False if the right is,
    None if there's no signal or they're too close to call (avoids jitter
    right at the crossing point).
    """
    heights = wrist_heights(pose_landmarks, left_hand_landmarks, right_hand_landmarks)
    if heights is None:
        return None
    left_y, right_y = heights
    if left_y < right_y - SIX_SEVEN_MARGIN:
        return True
    if right_y < left_y - SIX_SEVEN_MARGIN:
        return False
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera-index", type=int, default=1,
                         help="cv2.VideoCapture device index -- defaults to 1 since on this machine "
                              "index 0 grabs an iPhone Continuity Camera instead of the built-in webcam")
    parser.add_argument("--min-confidence", type=float, default=0.6,
                         help="minimum prediction probability to count a gesture as confirmed")
    parser.add_argument("--clip-seconds", type=float, default=1.5,
                         help="must match --clip-seconds used in capture_clips.py")
    parser.add_argument("--keyframes", type=int, default=8,
                         help="must match --keyframes used in capture_clips.py")
    parser.add_argument("--target", default=None,
                         help="gesture label to race against, e.g. six_seven -- flashes RECOGNIZED! when seen")
    args = parser.parse_args()

    bundle = joblib.load(MODEL_PATH)
    clf, labels = bundle["model"], bundle["labels"]
    target = args.target.upper() if args.target else None
    if target and target not in [l.upper() for l in labels]:
        print(f"Warning: --target {args.target!r} doesn't match any trained label: {labels}")

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

    window = deque()  # (timestamp, 102-value per-frame features) -- the current gesture attempt's clip so far
    last_signal_at = None
    round_started_at = time.time()
    recognized_at = None  # elapsed seconds when --target was first confidently recognized

    print("Press 'r' to reset the target timer, 'q' to quit.\n")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = tracker.process(rgb)

        if res.pose_landmarks:
            mp_draw.draw_landmarks(frame, res.pose_landmarks, mp_pose.POSE_CONNECTIONS)
        if res.left_hand_landmarks:
            mp_draw.draw_landmarks(frame, res.left_hand_landmarks, mp_hands.HAND_CONNECTIONS)
        if res.right_hand_landmarks:
            mp_draw.draw_landmarks(frame, res.right_hand_landmarks, mp_hands.HAND_CONNECTIONS)

        now = time.time()
        body_tracked = pose_is_usable(res.pose_landmarks)
        has_signal = bool(body_tracked or res.left_hand_landmarks or res.right_hand_landmarks)
        if has_signal:
            last_signal_at = now
            h, w = frame.shape[:2]
            window.append((now, frame_to_row(res.pose_landmarks, res.left_hand_landmarks, res.right_hand_landmarks, w, h)))
        elif last_signal_at is not None and now - last_signal_at > NO_SIGNAL_RESET_SEC:
            window.clear()  # gesture ended -- next signal starts a fresh clip, not a blend with the last attempt
            last_signal_at = None
        while window and now - window[0][0] > args.clip_seconds:
            window.popleft()

        status_color = (0, 220, 0) if body_tracked else (0, 0, 255)
        cv2.putText(frame, f"BODY: {'tracked' if body_tracked else 'not tracked'}", (frame.shape[1] - 260, 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, status_color, 2, cv2.LINE_AA)

        order = six_seven_order(res.pose_landmarks, res.left_hand_landmarks, res.right_hand_landmarks)

        text = "No pose/hands detected"
        confirmed_label = None
        if window:
            frame_feats = [feats for _, feats in window]
            row = clip_to_row(frame_feats, args.keyframes)
            pred_id = clf.predict([row])[0]
            proba = clf.predict_proba([row])[0][pred_id]
            label = labels[pred_id]
            text = f"{label} ({proba:.0%})"
            if proba >= args.min_confidence:
                confirmed_label = label
            else:
                text += "  [low confidence]"

        if target and recognized_at is None and confirmed_label and confirmed_label.upper() == target:
            recognized_at = now - round_started_at

        cv2.putText(frame, text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 120), 2, cv2.LINE_AA)

        if target:
            if recognized_at is not None:
                msg = f"RECOGNIZED! ({recognized_at:.2f}s)"
                color = (0, 255, 0)
            else:
                msg = f"Target: {target}  ({now - round_started_at:.1f}s)"
                color = (0, 200, 255)
            cv2.putText(frame, msg, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA)

        if order is not None:
            order_text = "left high" if order else "right high"
            cv2.putText(frame, f"hand order: {order_text}", (10, frame.shape[0] - 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 255), 1, cv2.LINE_AA)

        cv2.imshow("Meme Sign - Live Prediction", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if key == ord("r"):
            round_started_at = time.time()
            recognized_at = None
            window.clear()
            last_signal_at = None
            print("Target timer reset.")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
