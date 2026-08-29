/**
 * Evaluates the RandomForest exported by frontend/public/memes/export_web_model.py
 * as plain JSON — no ML runtime dependency, just walking decision trees.
 */
export interface MemeTree {
  feature: number[]; // -2 marks a leaf
  threshold: number[];
  left: number[];
  right: number[];
  value: number[][]; // per-node class-probability distribution
}

export interface MemeForestData {
  labels: string[];
  trees: MemeTree[];
}

export interface MemePrediction {
  label: string;
  confidence: number;
}

function evalTree(tree: MemeTree, row: number[]): number[] {
  let node = 0;
  while (tree.feature[node] !== -2) {
    node = row[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

export class MemeForest {
  constructor(private readonly data: MemeForestData) {}

  get labels(): string[] {
    return this.data.labels;
  }

  /** Mean of every tree's leaf probability vector — matches sklearn's predict_proba. */
  predictProba(row: number[]): number[] {
    const sums = new Array(this.data.labels.length).fill(0);
    for (const tree of this.data.trees) {
      const proba = evalTree(tree, row);
      for (let i = 0; i < sums.length; i++) sums[i] += proba[i];
    }
    return sums.map((v) => v / this.data.trees.length);
  }

  predict(row: number[]): MemePrediction {
    const proba = this.predictProba(row);
    let best = 0;
    for (let i = 1; i < proba.length; i++) if (proba[i] > proba[best]) best = i;
    return { label: this.data.labels[best], confidence: proba[best] };
  }
}

export async function loadMemeForest(url = "/models/meme_forest.json"): Promise<MemeForest> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  const data: MemeForestData = await res.json();
  return new MemeForest(data);
}
