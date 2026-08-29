import type { Sign } from "@jutsu/protocol";

export function BufferRail({
  signs,
  label,
}: {
  signs: Sign[];
  label: string;
}) {
  return (
    <div className="rail">
      <span className="rail-label">{label}</span>
      <div className="rail-tiles">
        {signs.length === 0 ? (
          <span className="tile ghost">·</span>
        ) : (
          signs.map((s, i) => (
            <span key={`${s}-${i}`} className={`tile tile-${s}`}>
              {s}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
