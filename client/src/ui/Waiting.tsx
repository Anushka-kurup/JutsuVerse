export function Waiting({
  code,
  name,
  onCopy,
}: {
  code: string;
  name: string;
  onCopy: () => void;
}) {
  return (
    <main className="shell">
      <p className="eyebrow">waiting for opponent</p>
      <h1>
        Room <em>{code}</em>
      </h1>
      <p className="lede">
        {name}, share this code. The duel starts the moment the second player
        sits.
      </p>
      <div className="panel code-panel">
        <span className="code">{code}</span>
        <button type="button" onClick={onCopy} className="ghost">
          Copy
        </button>
      </div>
    </main>
  );
}
