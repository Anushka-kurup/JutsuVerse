import type { Seat } from "@jutsu/protocol";

export function Ended({
  seat,
  winner,
  onAgain,
}: {
  seat: Seat;
  winner: Seat | "draw" | null;
  onAgain: () => void;
}) {
  const title =
    winner === "draw"
      ? "Double KO"
      : winner === seat
        ? "You stand"
        : "You fall";

  return (
    <main className="shell">
      <p className="eyebrow">match ended</p>
      <h1>
        <em>{title}</em>
      </h1>
      <p className="lede">Three seals of blood. The loop is the game.</p>
      <button type="button" className="primary" onClick={onAgain}>
        New room
      </button>
    </main>
  );
}
