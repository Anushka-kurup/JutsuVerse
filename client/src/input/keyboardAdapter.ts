import { SIGNS, type Sign } from "@jutsu/protocol";
import type { InputAdapter, SignListener } from "./adapter.ts";

const KEY_MAP: Record<string, Sign> = {
  a: "TIGER",
  s: "SNAKE",
  w: "RAM",
  d: "BOAR",
  f: "BIRD",
  g: "OX",
  A: "TIGER",
  S: "SNAKE",
  W: "RAM",
  D: "BOAR",
  F: "BIRD",
  G: "OX",
};

export function createKeyboardAdapter(): InputAdapter {
  let listener: SignListener | null = null;
  const down = new Set<Sign>();

  const onKeyDown = (ev: KeyboardEvent) => {
    const sign = KEY_MAP[ev.key];
    if (!sign) return;
    if (ev.repeat) return;
    ev.preventDefault();
    if (down.has(sign)) return;
    down.add(sign);
    listener?.({ sign, edge: "down" });
  };

  const onKeyUp = (ev: KeyboardEvent) => {
    const sign = KEY_MAP[ev.key];
    if (!sign) return;
    ev.preventDefault();
    if (!down.has(sign)) return;
    down.delete(sign);
    listener?.({ sign, edge: "up" });
  };

  const releaseAll = () => {
    for (const sign of SIGNS) {
      if (!down.has(sign)) continue;
      down.delete(sign);
      listener?.({ sign, edge: "up" });
    }
  };

  return {
    start(onEdge) {
      listener = onEdge;
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", releaseAll);
    },
    stop() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
      listener = null;
    },
  };
}
