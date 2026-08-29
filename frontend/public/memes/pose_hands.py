"""
Arms + hands tracking, with no face model in the loop at all.

capture_clips.py and live_predict.py used to run mp.solutions.holistic.Holistic,
which internally always runs a full face-mesh model (468+ landmarks) as part of
its pipeline -- even though features.py never reads a single face landmark from
it. This tracker runs mp.solutions.pose.Pose (the 33-point body skeleton;
"pose" here means body pose/position, not a face model) and mp.solutions.hands.Hands
side by side instead, which is structurally incapable of producing a face
reading, and is a bit cheaper per frame since there's no face model to run.

process() returns an object shaped like Holistic's result (.pose_landmarks,
.left_hand_landmarks, .right_hand_landmarks) so features.py and the two
capture/predict scripts don't need to know the difference.
"""

import os

import certifi

# MediaPipe downloads model variants (e.g. the "Lite" pose model below) over
# HTTPS on first use. python.org's macOS installer doesn't wire the stdlib
# ssl module into the system cert store, so that download can fail with
# CERTIFICATE_VERIFY_FAILED on a fresh venv -- point it at certifi's bundle
# instead of depending on the user's shell having this set already.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

import mediapipe as mp

mp_pose = mp.solutions.pose
mp_hands = mp.solutions.hands


class PoseHandsResult:
    __slots__ = ("pose_landmarks", "left_hand_landmarks", "right_hand_landmarks")

    def __init__(self, pose_landmarks, left_hand_landmarks, right_hand_landmarks):
        self.pose_landmarks = pose_landmarks
        self.left_hand_landmarks = left_hand_landmarks
        self.right_hand_landmarks = right_hand_landmarks


class PoseHandsTracker:
    """Drop-in, face-free replacement for mp.solutions.holistic.Holistic.

    model_complexity defaults to MediaPipe's own default (1, "Full") for
    capture_clips.py, where accuracy matters more than speed and it only
    runs while a clip is actively being recorded. live_predict.py runs this
    on every camera frame continuously, so it passes model_complexity=0
    ("Lite") for lower per-frame latency -- same tradeoff the browser makes
    with pose_landmarker_lite.task.
    """

    def __init__(self, min_detection_confidence=0.5, min_tracking_confidence=0.5, model_complexity=1):
        self._pose = mp_pose.Pose(
            model_complexity=model_complexity,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self._hands = mp_hands.Hands(
            max_num_hands=2,
            model_complexity=model_complexity,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )

    def process(self, rgb_image) -> PoseHandsResult:
        pose_result = self._pose.process(rgb_image)
        hands_result = self._hands.process(rgb_image)

        left_hand = None
        right_hand = None
        if hands_result.multi_hand_landmarks and hands_result.multi_handedness:
            for landmarks, handedness in zip(
                hands_result.multi_hand_landmarks, hands_result.multi_handedness
            ):
                # MediaPipe's own anatomical label -- stable even if hands cross over
                if handedness.classification[0].label == "Left":
                    left_hand = landmarks
                else:
                    right_hand = landmarks

        return PoseHandsResult(pose_result.pose_landmarks, left_hand, right_hand)

    def close(self):
        self._pose.close()
        self._hands.close()
