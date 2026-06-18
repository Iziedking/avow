import { useCallback, useEffect, useState } from "react";
import {
  useCurrentAccount,
  useSignPersonalMessage,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { WalletConnect } from "./WalletConnect";
import { Docs } from "./Docs";
import { Transaction } from "@mysten/sui/transactions";
import { fetchRecords, fetchAccessId, type AnchoredRecord } from "./records";
import { findCapForMandate } from "./caps";
import { setupMandate } from "./setup";
import { verifyRecord } from "./verify";
import { Intro } from "./intro/Intro";
import { beep } from "./beep";
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

// Turn a data code like "yield_move" into a clear, professional label.
const ACTION_LABELS: Record<string, string> = {
  yield_move: "Yield rebalance",
  payment: "Payment",
  trade: "Trade",
  transfer: "Transfer",
};

function prettyAction(type: string): string {
  if (!type) return "Action";
  const known = ACTION_LABELS[type.toLowerCase()];
  if (known) return known;
  const words = type.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Mark() {
  return (
    <svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <path
        className="s1"
        pathLength={1}
        d="M150 392 L256 120 L362 392"
        stroke="#5fd08a"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="s2"
        pathLength={1}
        d="M196 300 L238 342 L322 236"
        stroke="#74e09c"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function App() {
  const [mandateId, setMandateId] = useState(DEMO_MANDATE_ID);
  const [input, setInput] = useState("");
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

  const [docsOpen, setDocsOpen] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).has("docs");
    } catch {
      return false;
    }
  });

  const [showIntro, setShowIntro] = useState(() => {
    try {
      // A ?app link skips straight to the dashboard.
      if (new URLSearchParams(window.location.search).has("app")) return false;
      return sessionStorage.getItem("avow-intro") !== "done";
    } catch {
      return true;
    }
  });

  // The page-load motion should run when the page is actually on screen, which is after the
  // intro hands off (or immediately when the intro is skipped), not while it is still covered.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!showIntro) setStarted(true);
  }, [showIntro]);

  // Read the three steps out as they drop in: one electronic blip each, rising in pitch.
  useEffect(() => {
    if (!started) return;
    const cues: [number, number][] = [
      [120, 660],
      [420, 830],
      [720, 990],
    ];
    const timers = cues.map(([ms, hz]) => window.setTimeout(() => beep(hz), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [started]);

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

  // Reveal sections as they scroll into view, the page assembling itself.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    // Safety net: never leave a section hidden if the observer is starved.
    const fallback = window.setTimeout(() => {
      els.forEach((el) => el.classList.add("is-in"));
    }, 1500);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [records.length, status, capId, setupOpen]);

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
    <>
      {showIntro && (
        <Intro
          onDone={() => {
            try {
              sessionStorage.setItem("avow-intro", "done");
            } catch {
              /* storage unavailable */
            }
            setShowIntro(false);
          }}
        />
      )}
      <div className="bg-grid" aria-hidden="true" />
      <div className="watermark" aria-hidden="true" />
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
          <WalletConnect />
        </div>
        <p className="lede">
          Money-moving AI agents ask you to trust their numbers. Avow makes them{" "}
          <strong>prove</strong> them. Every action an agent takes is locked away on Walrus and
          stamped on chain, so you, or anyone you allow, can check exactly what it did and that
          it stayed within the limits you set.
        </p>
      </header>

      <section className={`how hud${started ? " play" : ""}`}>
        <div className="how-step">
          <span className="how-n">1</span>
          <div>
            <h3>You set the rules</h3>
            <p>Decide what your agent may do: how much it can move, where, and for how long.</p>
          </div>
        </div>
        <div className="how-step">
          <span className="how-n">2</span>
          <div>
            <h3>The agent acts, and proves it</h3>
            <p>
              After each action it seals the details and stamps a proof on chain. An action
              that breaks your rules cannot produce a proof.
            </p>
          </div>
        </div>
        <div className="how-step">
          <span className="how-n">3</span>
          <div>
            <h3>Anyone you allow can check</h3>
            <p>
              Open a proof, unlock the details, and confirm it is real and within your rules.
              No trust required.
            </p>
          </div>
        </div>
      </section>

      <section className="finder">
        <label className="label" htmlFor="mandate">
          Look up a mandate
        </label>
        <p className="finder-hint">
          A mandate is the rulebook an agent runs under. Paste its id to see everything that
          agent has done.
        </p>
        <div className="finder-row">
          <input
            id="mandate"
            value={input}
            placeholder="paste a mandate id  0x…"
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) setMandateId(input.trim());
            }}
          />
          <button className="btn" onClick={() => input.trim() && setMandateId(input.trim())}>
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
            <div className="setup-body hud">
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
                  <em className="field-hint">The one wallet allowed to act under these rules.</em>
                </label>
                <label>
                  <span>Per-action limit</span>
                  <input
                    value={setupPerMove}
                    placeholder="1000000"
                    onChange={(e) => setSetupPerMove(e.target.value)}
                  />
                  <em className="field-hint">
                    The most it can move in a single action, in the smallest unit.
                  </em>
                </label>
                <label>
                  <span>Daily limit</span>
                  <input
                    value={setupDaily}
                    placeholder="10000000"
                    onChange={(e) => setSetupDaily(e.target.value)}
                  />
                  <em className="field-hint">The most it can move per day, added up.</em>
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
        <section className="owner-panel hud">
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

      <section className="summary hud">
        <div className="stat">
          <span className="stat-num">{moves}</span>
          <span className="stat-label">actions recorded</span>
        </div>
        <div className="stat">
          <span className="stat-num tnum">{group(totalMoved.toString())}</span>
          <span className="stat-label">total moved, in the token's smallest unit</span>
        </div>
      </section>

      <div className="records-head reveal">
        <span className="records-title">Track record</span>
        <span className="note mono">{short(mandateId, 8, 6)}</span>
      </div>
      <p className="records-intro reveal">
        Every action this agent has recorded, newest first. Open any one and verify it
        yourself, you never have to take the numbers on trust.
      </p>

      {status === "loading" && (
        <div className="loading">
          <span className="loading-label">retrieving record</span>
          <span className="loading-bar" />
        </div>
      )}
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
                  <span className="badge">{prettyAction(r.actionType)}</span>
                  {r.target && <span className="target">to {r.target}</span>}
                  <span className="amount-wrap">
                    <span className="amount-k">amount moved</span>
                    <span className="amount tnum">{group(r.amount)}</span>
                  </span>
                  <span
                    className={`status${v.status === "ok" ? " is-verified" : ""}`}
                    title={
                      v.status === "ok"
                        ? "You verified this record. The evidence is unaltered and within the rules."
                        : "Sealed and recorded on chain. Verify it to confirm it for yourself."
                    }
                  >
                    {v.status === "ok" ? "Verified" : "Recorded"}
                  </span>
                </div>

                <div className="record-meta">
                  {r.timestampMs ? (
                    <span>
                      <span className="k">recorded</span>
                      {formatTime(r.timestampMs)}
                    </span>
                  ) : null}
                  <span title="Sui's clock, where one epoch is roughly a day.">
                    <span className="k">Sui epoch</span>
                    {r.epoch}
                  </span>
                  <span title="A fingerprint of the sealed evidence. Verifying recomputes it and checks it still matches what was stamped on chain.">
                    <span className="k">evidence fingerprint</span>
                    {short(r.evidenceHashHex, 10, 8)}
                  </span>
                </div>

                <div className="record-links">
                  {r.txDigest && (
                    <a
                      href={`${SUISCAN}/tx/${r.txDigest}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the Sui transaction that recorded this on chain."
                    >
                      View the on-chain record
                    </a>
                  )}
                  <a
                    href={`${WALRUS_AGGREGATOR}/v1/blobs/${r.blobId}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the encrypted evidence on Walrus. It stays unreadable until you verify."
                  >
                    Open the sealed evidence
                  </a>
                  <button
                    className="verify-btn"
                    disabled={!account || v.status === "running"}
                    onClick={() => onVerify(r)}
                  >
                    {v.status === "running"
                      ? "checking…"
                      : account
                        ? "Verify it yourself"
                        : "Connect a wallet to verify"}
                  </button>
                </div>

                {v.status === "ok" && (
                  <div className="verify-result ok">
                    <strong>Verified.</strong> The evidence is unaltered and the move stayed
                    within the rules. The agent's own reasoning: “{v.rationale}”
                  </div>
                )}
                {v.status === "fail" && (
                  <div className="verify-result fail">
                    {v.error ?? "This record did not check out."}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="foot-note reveal">
        Each record points at evidence sealed on Walrus. Only a reader the owner authorized can
        decrypt it. The hash recomputed from that evidence has to match what was anchored on
        chain, or the record does not verify.
      </p>

      <footer className="site-foot reveal">
        <div className="foot-main">
          <div className="foot-brand">
            <span className="neon-wordmark">avow</span>
            <span className="foot-tag">proof, not trust</span>
          </div>
          <nav className="foot-links">
            <button className="foot-docs" onClick={() => setDocsOpen(true)}>
              Docs
            </button>
            <span className="foot-dot" />
            <a href="https://github.com/Iziedking/avow" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <span className="foot-dot" />
            <a href="https://www.npmjs.com/package/avow-sdk" target="_blank" rel="noreferrer">
              npm
            </a>
            <span className="foot-dot" />
            <span>Sui · Walrus · Seal</span>
            <span className="foot-dot" />
            <span>Sui Overflow 2026 · Walrus track</span>
          </nav>
        </div>
        <div className="foot-base">
          <span>Apache-2.0</span>
          <span className="foot-meta">testnet · {short(PACKAGE_ID)}</span>
        </div>
      </footer>
      </div>
      <Docs open={docsOpen} onClose={() => setDocsOpen(false)} />
    </>
  );
}
