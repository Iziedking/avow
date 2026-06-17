import { useCallback, useEffect, useState } from "react";
import { fetchRecords, type AnchoredRecord } from "./records";
import { DEMO_MANDATE_ID, SUISCAN, WALRUS_AGGREGATOR } from "./config";

function short(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function formatTime(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function App() {
  const [mandateId, setMandateId] = useState(DEMO_MANDATE_ID);
  const [input, setInput] = useState(DEMO_MANDATE_ID);
  const [records, setRecords] = useState<AnchoredRecord[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const load = useCallback(async (id: string) => {
    setStatus("loading");
    setError("");
    try {
      const recs = await fetchRecords(id.trim());
      setRecords(recs);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load(mandateId);
  }, [mandateId, load]);

  const moves = records.length;
  const totalMoved = records.reduce((sum, r) => sum + BigInt(r.amount || "0"), 0n);

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark">avow</span>
          <span className="brand-line">proof, not trust</span>
        </div>
        <p className="lede">
          The track record of an autonomous agent on Sui. Every move it made is anchored on
          chain and provable. Nobody has to take its word for what it did.
        </p>
      </header>

      <section className="finder">
        <label htmlFor="mandate">Mandate</label>
        <div className="finder-row">
          <input
            id="mandate"
            value={input}
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setMandateId(input);
            }}
          />
          <button onClick={() => setMandateId(input)}>Load record</button>
        </div>
      </section>

      <section className="summary">
        <div className="stat">
          <span className="stat-num">{moves}</span>
          <span className="stat-label">moves anchored</span>
        </div>
        <div className="stat">
          <span className="stat-num">{totalMoved.toString()}</span>
          <span className="stat-label">total moved (smallest unit)</span>
        </div>
      </section>

      {status === "loading" && <p className="note">Reading the chain…</p>}
      {status === "error" && <p className="note error">Could not load: {error}</p>}
      {status === "idle" && moves === 0 && (
        <p className="note">No anchored moves for this mandate yet.</p>
      )}

      <ul className="records">
        {records.map((r) => (
          <li className="record" key={`${r.txDigest}`}>
            <div className="record-top">
              <span className="badge">{r.actionType || "action"}</span>
              <span className="target">→ {r.target || "—"}</span>
              <span className="amount">{r.amount}</span>
              <span className="anchored" title="Anchored on chain, the move passed its mandate">
                anchored
              </span>
            </div>
            <div className="record-meta">
              <span className="meta-item">
                <span className="k">epoch</span> {r.epoch}
              </span>
              {r.timestampMs > 0 && (
                <span className="meta-item">
                  <span className="k">when</span> {formatTime(r.timestampMs)}
                </span>
              )}
              <span className="meta-item mono">
                <span className="k">hash</span> {short(r.evidenceHashHex, 10, 8)}
              </span>
            </div>
            <div className="record-links">
              <a href={`${SUISCAN}/tx/${r.txDigest}`} target="_blank" rel="noreferrer">
                anchor tx
              </a>
              <a
                href={`${WALRUS_AGGREGATOR}/v1/blobs/${r.blobId}`}
                target="_blank"
                rel="noreferrer"
              >
                sealed evidence on walrus
              </a>
            </div>
          </li>
        ))}
      </ul>

      <footer className="foot">
        <p>
          Each record points at evidence sealed on Walrus. An authorized reader can decrypt it,
          recompute the hash, and confirm it matches the anchor. That step is coming to this
          page next.
        </p>
      </footer>
    </div>
  );
}
