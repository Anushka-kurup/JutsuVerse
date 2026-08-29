import { useEffect, useRef, useState } from "react";
import {
  SIGNS,
  type Edge,
  type FighterPublic,
  type Seat,
  type Sign,
} from "@jutsu/protocol";
import { createKeyboardAdapter } from "../input/keyboardAdapter.ts";
import type { GameSocket } from "../net/wsClient.ts";
import { CameraStage } from "./CameraStage.tsx";
import { FighterCard } from "./FighterCard.tsx";
import { HealthBar } from "./HealthBar.tsx";
import { MOVE_HINTS } from "./moves.ts";
import { Pad } from "./Pad.tsx";

export function Duel({
  socket,
  seat,
  youName,
  foeName,
  a,
  b,
}: {
  socket: GameSocket;
  seat: Seat;
  youName: string;
  foeName: string;
  a: FighterPublic;
  b: FighterPublic;
}) {
  const [held, setHeld] = useState<Set<Sign>>(() => new Set());
  const heldRef = useRef(held);
  heldRef.current = held;

  const emit = (sign: Sign, edge: Edge) => {
    setHeld((prev) => {
      const next = new Set(prev);
      if (edge === "down") next.add(sign);
      else next.delete(sign);
      return next;
    });
    socket.send({
      type: "input",
      seq: socket.nextSeq,
      sign,
      edge,
      tClient: performance.now(),
    });
  };

  useEffect(() => {
    const kb = createKeyboardAdapter();
    kb.start(({ sign, edge }) => emit(sign, edge));
    const keep = window.setInterval(() => {
      for (const sign of SIGNS) {
        if (!heldRef.current.has(sign)) continue;
        socket.send({
          type: "input",
          seq: socket.nextSeq,
          sign,
          edge: "down",
          tClient: performance.now(),
        });
      }
    }, 200);
    return () => {
      kb.stop();
      window.clearInterval(keep);
    };
    // socket is stable for the match
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const you = seat === "a" ? a : b;
  const foe = seat === "a" ? b : a;

  return (
    <main className="arena">
      <header className="hud-top">
        <HealthBar name={youName} you fighter={you} />
        <span className="hud-vs">vs</span>
        <HealthBar name={foeName} you={false} fighter={foe} />
      </header>
      <p className="hint">
        {MOVE_HINTS.map((m) => (
          <span key={m.name} className="hint-move">
            <kbd>{m.seq}</kbd> {m.name}
          </span>
        ))}
      </p>
      <div className="cards">
        <FighterCard name={youName} you fighter={you} />
        <FighterCard name={foeName} you={false} fighter={foe} />
      </div>
      <CameraStage onEdge={emit} />
      <Pad held={held} onEdge={emit} />
    </main>
  );
}
