"""
Export meme_sign_model.pkl to a plain-JSON tree ensemble the browser can
evaluate directly, with no ML runtime dependency at all.

Skipped ONNX on purpose: onnxruntime-web's support for scikit-learn's
TreeEnsembleClassifier op is inconsistent across builds, and this model is a
RandomForestClassifier -- a set of decision trees, each just nested
threshold comparisons on the same 98-value-per-frame feature vector
features.py already computes. Walking that structure in plain TypeScript is
simpler than shipping a second inference runtime, and the exported format
never changes shape as the dataset grows, only size.

Usage:
    python export_web_model.py
"""

import json
import os

import joblib
import numpy as np

MODEL_PATH = os.path.join(os.path.dirname(__file__), "meme_sign_model.pkl")
# frontend/public/models/ is where every other browser-facing model already lives
# (see frontend/src/gesture/YoloxHandSign.ts, lab/tracker.ts).
OUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "models", "meme_forest.json"
)


def export_tree(tree) -> dict:
    """One sklearn DecisionTreeClassifier's tree_ as flat parallel arrays.
    feature[i] == -2 marks a leaf; value[i] is that node's class distribution,
    normalized to probabilities (only leaves are read at inference time, but
    exporting all nodes costs nothing and keeps this format uniform)."""
    value = tree.value[:, 0, :]  # (node_count, n_classes) -- squeeze sklearn's dummy output dim
    totals = value.sum(axis=1, keepdims=True)
    totals[totals == 0] = 1.0
    proba = value / totals
    return {
        "feature": tree.feature.tolist(),
        "threshold": tree.threshold.tolist(),
        "left": tree.children_left.tolist(),
        "right": tree.children_right.tolist(),
        "value": proba.tolist(),
    }


def main():
    bundle = joblib.load(MODEL_PATH)
    clf, labels = bundle["model"], bundle["labels"]

    out = {
        "labels": labels,
        "trees": [export_tree(estimator.tree_) for estimator in clf.estimators_],
    }

    out_path = os.path.normpath(OUT_PATH)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"Exported {len(out['trees'])} trees, {len(labels)} labels to {out_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
