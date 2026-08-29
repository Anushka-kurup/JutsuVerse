import { useEffect, useRef, useState } from "react";
import {
  MAX_HP,
  type FighterPublic,
  type Seat,
  type ServerMsg,
} from "@jutsu/protocol";
import { GameSocket } from "./net/wsClient.ts";
import { Duel } from "./ui/Duel.tsx";
import { Ended } from "./ui/Ended.tsx";
import { Lobby } from "./ui/Lobby.tsx";
import { Waiting } from "./ui/Waiting.tsx";

type Screen = "lobby" | "waiting" | "duel" | "ended";

const EMPTY: FighterPublic = {
  hp: MAX_HP,
  stance: "idle",
  moveId: null,
  buffer: [],
  held: [],
  guardLeft: 0,
};

export function App() {
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) socketRef.current = new GameSocket();
  const socket = socketRef.current;

  const [screen, setScreen] = useState<Screen>("lobby");
  const [error, setError] = useState<string | null>(null);
  const [seat, setSeat] = useState<Seat>("a");
  const [code, setCode] = useState("");
  const [youName, setYouName] = useState("Ronin");
  const [foeName, setFoeName] = useState("Opponent");
  const [a, setA] = useState<FighterPublic>(EMPTY);
  const [b, setB] = useState<FighterPublic>(EMPTY);
  const [winner, setWinner] = useState<Seat | "draw" | null>(null);
  const [readySent, setReadySent] = useState(false);

  useEffect(() => {
    socket.connect((msg: ServerMsg) => {
      switch (msg.type) {
        case "joined":
          setSeat(msg.seat);
          setCode(msg.code);
          setYouName(msg.name);
          setError(null);
          if (msg.peerPresent) {
            setScreen("duel");
          } else {
            setScreen("waiting");
          }
          break;
        case "peer_joined":
          setFoeName(msg.name);
          setScreen("duel");
          break;
        case "peer_left":
          setScreen("ended");
          break;
        case "state":
          setA(msg.a);
          setB(msg.b);
          break;
        case "match_state":
          if (msg.phase === "ended") {
            setWinner(msg.winner ?? null);
            setScreen("ended");
          }
          break;
        case "error":
          setError(msg.message);
          break;
        default:
          break;
      }
    });
    return () => socket.close();
  }, [socket]);

  useEffect(() => {
    if (screen === "duel" && !readySent) {
      socket.send({ type: "ready" });
      setReadySent(true);
    }
  }, [screen, readySent, socket]);

  const reset = () => {
    socket.send({ type: "leave" });
    setScreen("lobby");
    setError(null);
    setReadySent(false);
    setA(EMPTY);
    setB(EMPTY);
    setWinner(null);
    setFoeName("Opponent");
  };

  if (screen === "waiting") {
    return (
      <Waiting
        code={code}
        name={youName}
        onCopy={() => void navigator.clipboard.writeText(code)}
      />
    );
  }

  if (screen === "duel") {
    return (
      <Duel
        socket={socket}
        seat={seat}
        youName={youName}
        foeName={foeName}
        a={a}
        b={b}
      />
    );
  }

  if (screen === "ended") {
    return <Ended seat={seat} winner={winner} onAgain={reset} />;
  }

  return (
    <Lobby
      error={error}
      onCreate={(name) => socket.send({ type: "join", name })}
      onJoin={(name, joinCode) =>
        socket.send({ type: "join", name, code: joinCode })
      }
    />
  );
}
