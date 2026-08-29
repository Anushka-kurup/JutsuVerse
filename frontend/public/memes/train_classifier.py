"""
Train a classifier on the clip_keypoint.csv dataset produced by capture_clips.py.
Each row is one gesture clip (a fixed number of resampled keyframes,
flattened), not a single static frame -- so the classifier gets motion
information, not just a freeze-frame shape.

Usage:
    python train_classifier.py
"""

import csv
import os

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

from features import load_labels

DATA_CSV = os.path.join(os.path.dirname(__file__), "clip_keypoint.csv")
MODEL_OUT = os.path.join(os.path.dirname(__file__), "meme_sign_model.pkl")


def load_dataset():
    X, y = [], []
    with open(DATA_CSV) as f:
        for row in csv.reader(f):
            if not row:
                continue
            y.append(int(row[0]))
            X.append([float(v) for v in row[1:]])
    return np.array(X), np.array(y)


def main():
    labels = load_labels()
    X, y = load_dataset()

    if len(X) == 0:
        print(f"No data found in {DATA_CSV}. Run capture_clips.py first.")
        return

    counts = {i: int((y == i).sum()) for i in range(len(labels))}
    print("Samples per class:")
    for i, label in enumerate(labels):
        print(f"  {label}: {counts.get(i, 0)}")
    present = sorted(i for i, n in counts.items() if n > 0)
    missing = [labels[i] for i in range(len(labels)) if i not in present]
    if missing:
        print(f"\nNo data yet for: {', '.join(missing)}. "
              f"Training on the {len(present)} classes that do have data.")
    if any(counts[i] < 30 for i in present):
        print("\nWarning: some classes have very few samples (<30). "
              "Collect more before trusting the model's accuracy.\n")

    # A stratified split needs at least one test-set sample per class, so it
    # needs roughly test_size * len(X) >= len(present). With an early, small
    # custom dataset that's often not true yet -- sklearn would just raise --
    # so fall back to training on everything and skip the held-out report
    # rather than crash.
    test_size = 0.2
    if min(counts[i] for i in present) >= 2 and test_size * len(X) >= len(present):
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42, stratify=y
        )
    else:
        print("Not enough data yet for a held-out test split (need several samples per "
              "class). Training on everything, with no accuracy report -- collect more "
              "clips per class and re-run for a real evaluation.")
        X_train, y_train = X, y
        X_test = y_test = None

    clf = RandomForestClassifier(n_estimators=200, random_state=42)
    clf.fit(X_train, y_train)

    if X_test is not None:
        y_pred = clf.predict(X_test)
        print("\nClassification report (held-out test set):")
        print(classification_report(y_test, y_pred, labels=present, target_names=[labels[i] for i in present]))

    joblib.dump({"model": clf, "labels": labels}, MODEL_OUT)
    print(f"Saved model to {MODEL_OUT}")


if __name__ == "__main__":
    main()
