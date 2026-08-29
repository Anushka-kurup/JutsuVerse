import { useState } from "react";

export function Lobby({
  onCreate,
  onJoin,
  error,
}: {
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  return (
    <main className="shell">
      <p className="eyebrow">unranked · seals · camera or keys</p>
      <h1>
        Jutsu <em>Duel</em>
      </h1>
      <p className="lede">
        Real-time 1v1. Six seals: <kbd>TIGER</kbd>
        <kbd>SNAKE</kbd>
        <kbd>RAM</kbd>
        <kbd>BOAR</kbd>
        <kbd>BIRD</kbd>
        <kbd>OX</kbd>. Sequences are moves — <kbd>TIGER SNAKE RAM</kbd> tiger,{" "}
        <kbd>BOAR SNAKE</kbd> guard (2s, damage halved). Camera or keyboard; both
        of you can act at any moment.
      </p>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim() || "Ronin";
          if (code.trim()) onJoin(n, code.trim().toUpperCase());
          else onCreate(n);
        }}
      >
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ronin"
            maxLength={24}
            autoComplete="off"
          />
        </label>
        <label>
          Room code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="leave blank to create"
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="row">
          <button type="submit" className="primary">
            {code.trim() ? "Join duel" : "Create duel"}
          </button>
        </div>
      </form>
    </main>
  );
}
