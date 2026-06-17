import { useCallback, useEffect, useState } from "react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignPersonalMessage,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { fetchRecords, fetchAccessId, type AnchoredRecord } from "./records";
import { findCapForMandate } from "./caps";
import { setupMandate } from "./setup";
import { verifyRecord } from "./verify";
import { DEMO_MANDATE_ID, PACKAGE_ID, SUISCAN, WALRUS_AGGREGATOR } from "./config";

type VerifyStatus = "idle" | "running" | "ok" | "fail";
interface VerifyState {
  status: VerifyStatus;
  rationale?: string;
  error?: string;
}

function short(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function group(n: string): string {
  return /^\d+$/.test(n) ? n.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : n;
}

function formatTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Mark() {
  return (
    <svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <circle cx="256" cy="256" r="150" stroke="#5fd08a" strokeOpacity="0.28" strokeWidth="14" />
      <path
        d="M182 262 L236 316 L334 196"
        stroke="#5fd08a"
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function App() {
  const [mandateId, setMandateId] = useState(DEMO_MANDATE_ID);
  const [input, setInput] = useState(DEMO_MANDATE_ID);
  const [records, setRecords] = useState<AnchoredRecord[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});

  const [capId, setCapId] = useState<string | null>(null);
  const [accessId, setAccessId] = useState<string | null>(null);
  const [auditor, setAuditor] = useState("");
  const [grant, setGrant] = useState<{ status: "idle" | "running" | "ok" | "fail"; msg?: string }>(
    { status: "idle" },
  );

  const [setupOpen, setSetupOpen] = useState(false);
  const [setupAgent, setSetupAgent] = useState("");
  const [setupPerMove, setSetupPerMove] = useState("");
  const [setupDaily, setSetupDaily] = useState("");
  const [setupState, setSetupState] = useState<{
    status: "idle" | "running" | "ok" | "fail";
    result?: { mandateId: string; accessId: string; capId: string };
    error?: string;
  }>({ status: "idle" });

  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const load = useCallback(async (id: string) => {
    setStatus("loading");
    setError("");
    setVerify({});
    try {
      setRecords(await fetchRecords(id.trim()));
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load(mandateId);
  }, [mandateId, load]);

  useEffect(() => {
    let cancelled = false;
    setCapId(null);
    setGrant({ status: "idle" });
    (async () => {
      const acc = await fetchAccessId(mandateId).catch(() => null);
      if (!cancelled) setAccessId(acc);
      if (account) {
        const cap = await findCapForMandate(account.address, mandateId).catch(() => null);
        if (!cancelled) setCapId(cap);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, mandateId]);

  const onVerify = useCallback(
    async (r: AnchoredRecord) => {
      if (!account) return;
      const key = r.txDigest ?? r.blobId;
      setVerify((s) => ({ ...s, [key]: { status: "running" } }));
      try {
        const out = await verifyRecord(r, account.address, async ({ message }) => {
          const res = await signPersonalMessage({ message });
          return { signature: res.signature };
        });
        setVerify((s) => ({
          ...s,
          [key]: {
            status: out.hashMatches ? "ok" : "fail",
            rationale: out.rationale,
            error: out.hashMatches ? undefined : "Recomputed hash did not match the anchor.",
          },
        }));
      } catch (e) {
        setVerify((s) => ({
          ...s,
          [key]: { status: "fail", error: e instanceof Error ? e.message : String(e) },
        }));
      }
    },
    [account, signPersonalMessage],
  );

  const onGrant = useCallback(async () => {
    if (!capId || !accessId || !auditor.trim()) return;
    setGrant({ status: "running" });
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::record::add_auditor`,
        arguments: [tx.object(accessId), tx.object(capId), tx.pure.address(auditor.trim())],
      });
      const res = await signAndExecute({ transaction: tx });
      setGrant({ status: "ok", msg: `Granted. They can verify now. tx ${res.digest.slice(0, 10)}…` });
      setAuditor("");
    } catch (e) {
      setGrant({ status: "fail", msg: e instanceof Error ? e.message : String(e) });
    }
  }, [capId, accessId, auditor, signAndExecute]);

  const onSetup = useCallback(async () => {
    if (!account) return;
    setSetupState({ status: "running" });
    try {
      const result = await setupMandate((i) => signAndExecute(i), {
        agent: setupAgent.trim() || account.address,
        perMoveCap: BigInt(setupPerMove || "0"),
        dailyCap: BigInt(setupDaily || "0"),
        expiryEpoch: 100000n,
      });
      setSetupState({ status: "ok", result });
      setInput(result.mandateId);
      setMandateId(result.mandateId);
    } catch (e) {
      setSetupState({ status: "fail", error: e instanceof Error ? e.message : String(e) });
    }
  }, [account, setupAgent, setupPerMove, setupDaily, signAndExecute]);

  const moves = records.length;
  const totalMoved = records.reduce((sum, r) => sum + BigInt(r.amount || "0"), 0n);

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-top">
          <div className="brand">
            <Mark />
            <div className="brand-text">
              <span className="brand-mark">avow</span>
              <span className="brand-line">proof, not trust</span>
            </div>
          </div>
          <ConnectButton />
        </div>
        <p className="lede">
          The track record of an autonomous agent on Sui. Every move it made is anchored on
          chain and provable. <strong>Connect a wallet you authorized</strong> to decrypt the
          evidence and watch each move verify against its anchor.
        </p>
      </header>

      <section className="finder">
        <label className="label" htmlFor="mandate">
          Mandate
        </label>
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
          <button className="btn" onClick={() => setMandateId(input)}>
            Load
          </button>
        </div>
      </section>

      {account && (
        <section className="setup">
          <button className="btn-ghost" onClick={() => setSetupOpen((o) => !o)}>
            {setupOpen ? "Hide setup" : "Set up an agent"}
          </button>
          {setupOpen && (
            <div className="setup-body">
              <p className="setup-hint">
                Create a mandate for your agent. You become the owner. The agent address you
                name is the only one that can anchor against it.
              </p>
              <div className="setup-grid">
                <label>
                  <span>Agent address</span>
                  <input
                    value={setupAgent}
                    placeholder={account.address}
                    spellCheck={false}
                    onChange={(e) => setSetupAgent(e.target.value)}
                  />
                </label>
                <label>
                  <span>Per-move cap</span>
                  <input
                    value={setupPerMove}
                    placeholder="1000000"
                    onChange={(e) => setSetupPerMove(e.target.value)}
                  />
                </label>
                <label>
                  <span>Daily cap</span>
                  <input
                    value={setupDaily}
                    placeholder="10000000"
                    onChange={(e) => setSetupDaily(e.target.value)}
                  />
                </label>
              </div>
              <button
                className="btn-green"
                onClick={onSetup}
                disabled={setupState.status === "running"}
                style={{ padding: "10px 18px" }}
              >
                {setupState.status === "running" ? "creating…" : "Create mandate"}
              </button>
              {setupState.status === "ok" && setupState.result && (
                <div className="verify-result ok">
                  <strong>Created and loaded above.</strong> mandate{" "}
                  {short(setupState.result.mandateId)} · access{" "}
                  {short(setupState.result.accessId)}
                </div>
              )}
              {setupState.status === "fail" && (
                <div className="verify-result fail">{setupState.error}</div>
              )}
            </div>
          )}
        </section>
      )}

      {capId && (
        <section className="owner-panel">
          <label className="label" htmlFor="auditor">
            You own this mandate · grant an auditor read access
          </label>
          <div className="finder-row">
            <input
              id="auditor"
              placeholder="auditor address 0x…"
              value={auditor}
              spellCheck={false}
              onChange={(e) => setAuditor(e.target.value)}
            />
            <button
              className="btn-green"
              onClick={onGrant}
              disabled={grant.status === "running" || !auditor.trim()}
            >
              {grant.status === "running" ? "granting…" : "Grant"}
            </button>
          </div>
          {grant.status === "ok" && <p className="note ok-note">{grant.msg}</p>}
          {grant.status === "fail" && <p className="note error">{grant.msg}</p>}
        </section>
      )}

      <section className="summary">
        <div className="stat">
          <span className="stat-num">{moves}</span>
          <span className="stat-label">moves anchored</span>
        </div>
        <div className="stat">
          <span className="stat-num tnum">{group(totalMoved.toString())}</span>
          <span className="stat-label">total moved · smallest unit</span>
        </div>
      </section>

      <div className="records-head">
        <span className="records-title">Track record</span>
        <span className="note">{short(mandateId, 8, 6)}</span>
      </div>

      {status === "loading" && <p className="note">Reading the chain…</p>}
      {status === "error" && <p className="note error">Could not load: {error}</p>}
      {status === "idle" && moves === 0 && (
        <p className="note">No anchored moves for this mandate yet.</p>
      )}

      <ul className="records">
        {records.map((r, i) => {
          const key = r.txDigest ?? r.blobId;
          const v = verify[key] ?? { status: "idle" as VerifyStatus };
          return (
            <li className="record" key={key} style={{ animationDelay: `${i * 40}ms` }}>
              <div className="record-index tnum">{String(i + 1).padStart(2, "0")}</div>
              <div className="record-main">
                <div className="record-top">
                  <span className="badge">{r.actionType || "action"}</span>
                  <span className="target">{r.target || "—"}</span>
                  <span className="amount tnum">{group(r.amount)}</span>
                  <span className={`status${v.status === "ok" ? " is-verified" : ""}`}>
                    {v.status === "ok" ? "verified" : "anchored"}
                  </span>
                </div>

                <div className="record-meta">
                  <span>
                    <span className="k">epoch</span>
                    {r.epoch}
                  </span>
                  {r.timestampMs ? (
                    <span>
                      <span className="k">when</span>
                      {formatTime(r.timestampMs)}
                    </span>
                  ) : null}
                  <span>
                    <span className="k">hash</span>
                    {short(r.evidenceHashHex, 10, 8)}
                  </span>
                </div>

                <div className="record-links">
                  {r.txDigest && (
                    <a href={`${SUISCAN}/tx/${r.txDigest}`} target="_blank" rel="noreferrer">
                      anchor tx
                    </a>
                  )}
                  <a
                    href={`${WALRUS_AGGREGATOR}/v1/blobs/${r.blobId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    sealed evidence
                  </a>
                  <button
                    className="verify-btn"
                    disabled={!account || v.status === "running"}
                    onClick={() => onVerify(r)}
                  >
                    {v.status === "running"
                      ? "verifying…"
                      : account
                        ? "verify privately"
                        : "connect to verify"}
                  </button>
                </div>

                {v.status === "ok" && (
                  <div className="verify-result ok">
                    <strong>Hash matches the anchor.</strong> The agent's reasoning was: “
                    {v.rationale}”
                  </div>
                )}
                {v.status === "fail" && (
                  <div className="verify-result fail">{v.error ?? "Verification failed."}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="foot">
        Each record points at evidence sealed on Walrus. Only a reader the owner authorized can
        decrypt it. The hash recomputed from that evidence has to match what was anchored on
        chain, or the record does not verify.
      </footer>
    </div>
  );
}
