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

DATA_CSV = os.path.join(os.path.dirname(__file__), "clip_keypoint.csv")
LABELS_CSV = os.path.join(os.path.dirname(__file__), "labels.csv")
MODEL_OUT = os.path.join(os.path.dirname(__file__), "meme_sign_model.pkl")


def load_labels():
    with open(LABELS_CSV) as f:
        return [row[0] for row in csv.reader(f) if row]


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
    if min(counts.values()) < 30:
        print("\nWarning: some classes have very few samples (<30). "
              "Collect more before trusting the model's accuracy.\n")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    clf = RandomForestClassifier(n_estimators=200, random_state=42)
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    print("\nClassification report (held-out test set):")
    print(classification_report(y_test, y_pred, target_names=labels))

    joblib.dump({"model": clf, "labels": labels}, MODEL_OUT)
    print(f"Saved model to {MODEL_OUT}")


if __name__ == "__main__":
    main()
