import { SIGNS, type Edge, type Sign } from "@jutsu/protocol";

const KEY_HINT: Record<Sign, string> = {
  TIGER: "A",
  SNAKE: "S",
  RAM: "W",
  BOAR: "D",
  BIRD: "F",
  OX: "G",
};

export function Pad({
  held,
  onEdge,
}: {
  held: Set<Sign>;
  onEdge: (sign: Sign, edge: Edge) => void;
}) {
  return (
    <div className="pad">
      {SIGNS.map((sign) => (
        <button
          key={sign}
          type="button"
          className={`pad-key ${held.has(sign) ? "held" : ""} pad-${sign}`}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
            onEdge(sign, "down");
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            onEdge(sign, "up");
          }}
          onPointerCancel={() => onEdge(sign, "up")}
        >
          <strong>{sign}</strong>
          <span>{KEY_HINT[sign]}</span>
        </button>
      ))}
    </div>
  );
}
