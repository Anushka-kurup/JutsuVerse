"""
Probes camera indices 0-4 and shows a quick preview of each so you can tell
which index is your real built-in webcam vs. an iPhone Continuity Camera or
other virtual device, before running capture_clips.py / live_predict.py.

Usage:
    python list_cameras.py

For each index that opens successfully, a window pops up showing a live
feed labeled with its index. Press any key to move to the next index.
"""

import cv2


def main():
    for index in range(5):
        cap = cv2.VideoCapture(index)
        if not cap.isOpened():
            print(f"index {index}: could not open")
            cap.release()
            continue

        ret, frame = cap.read()
        if not ret:
            print(f"index {index}: opened but no frame (likely wrong/virtual device)")
            cap.release()
            continue

        h, w = frame.shape[:2]
        print(f"index {index}: OK, {w}x{h} -- showing preview, press any key to continue")
        cv2.putText(frame, f"camera index {index} -- press any key", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 120), 2, cv2.LINE_AA)
        cv2.imshow("Camera probe", frame)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
        cap.release()

    print("\nUse whichever index showed YOUR actual face/room, e.g.:")
    print("  python capture_clips.py --camera-index <N>")


if __name__ == "__main__":
    main()
