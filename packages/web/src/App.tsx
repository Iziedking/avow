import { useCallback, useEffect, useRef, useState } from "react";
import {
  useCurrentAccount,
  useSignPersonalMessage,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { WalletConnect } from "./WalletConnect";
import { Docs } from "./Docs";
import { Transaction } from "@mysten/sui/transactions";
import {
  fetchRecords,
  fetchAccessId,
  fetchMandate,
  fetchMyMandates,
  type AnchoredRecord,
  type MandateInfo,
} from "./records";
import { findCapForMandate } from "./caps";
import { setupMandate } from "./setup";
import { verifyRecord, type SignPersonalMessage } from "./verify";
import { describeObserved } from "./reveal";
import { Intro } from "./intro/Intro";
import { AgentRun } from "./AgentRun";
import type { SignAndExecute } from "./anchorLive";
import { beep, setBeepMuted } from "./beep";
import { DEMO_MANDATE_ID, DEMO_AGENTS, PACKAGE_ID, SUISCAN, WALRUS_AGGREGATOR } from "./config";

type VerifyStatus = "idle" | "running" | "ok" | "fail";
interface VerifyState {
  status: VerifyStatus;
  rationale?: string;
  observed?: unknown;
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
  payment_refused: "Payment refused",
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
  const [mandate, setMandate] = useState<MandateInfo | null>(null);
  const [recordsPage, setRecordsPage] = useState(0);
  const [myMandates, setMyMandates] = useState<string[]>([]);

  // The consumer "verify" view is the default; "build" adds the developer tools.
  const [mode, setMode] = useState<"verify" | "build">(() => {
    try {
      return new URLSearchParams(window.location.search).has("dev") ? "build" : "verify";
    } catch {
      return "verify";
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundMuted, setSoundMuted] = useState(() => {
    try {
      return localStorage.getItem("avow-muted") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    setBeepMuted(soundMuted);
    try {
      localStorage.setItem("avow-muted", soundMuted ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [soundMuted]);

  const settingsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);
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

  // A mandate this wallet just registered as its own agent, so the live-anchor finale can run.
  const [liveTarget, setLiveTarget] = useState<{ mandateId: string; accessId: string } | null>(
    null,
  );

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
      [250, 660],
      [900, 830],
      [1550, 990],
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
    setRecordsPage(0);
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
    setMandate(null);
    setGrant({ status: "idle" });
    (async () => {
      const acc = await fetchAccessId(mandateId).catch(() => null);
      if (!cancelled) setAccessId(acc);
      const info = await fetchMandate(mandateId).catch(() => null);
      if (!cancelled) setMandate(info);
      if (account) {
        const cap = await findCapForMandate(account.address, mandateId).catch(() => null);
        if (!cancelled) setCapId(cap);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, mandateId]);

  // The agents this wallet owns, so it can inspect its own without pasting ids.
  useEffect(() => {
    if (!account) {
      setMyMandates([]);
      return;
    }
    let cancelled = false;
    fetchMyMandates(account.address)
      .then((ids) => {
        if (!cancelled) setMyMandates(ids);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account]);

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
            observed: out.bundle?.observed,
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
      const agentAddr = setupAgent.trim() || account.address;
      const result = await setupMandate((i) => signAndExecute(i), {
        agent: agentAddr,
        // Sensible non-zero defaults so a registered mandate can actually record actions.
        perMoveCap: BigInt(setupPerMove || "1000000"),
        dailyCap: BigInt(setupDaily || "10000000"),
        expiryEpoch: 100000n,
      });
      setSetupState({ status: "ok", result });
      // If this wallet is the agent, it can create a live proof against the new mandate.
      if (agentAddr === account.address) {
        setLiveTarget({ mandateId: result.mandateId, accessId: result.accessId });
      }
      setInput(result.mandateId);
      setMandateId(result.mandateId);
    } catch (e) {
      setSetupState({ status: "fail", error: e instanceof Error ? e.message : String(e) });
    }
  }, [account, setupAgent, setupPerMove, setupDaily, signAndExecute]);

  const moves = records.length;
  const totalMoved = records.reduce((sum, r) => sum + BigInt(r.amount || "0"), 0n);

  const PER_PAGE = 6;
  const pageCount = Math.max(1, Math.ceil(records.length / PER_PAGE));
  const page = Math.min(recordsPage, pageCount - 1);
  const pageRecords = records.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  // The live-anchor finale runs only when the connected wallet is the agent of this mandate.
  const youAreAgent =
    !!account &&
    (mandate?.agent === account.address || liveTarget?.mandateId === mandateId);
  const liveAccessId = liveTarget?.mandateId === mandateId ? liveTarget.accessId : accessId;
  const runAnchor: SignAndExecute = async ({ transaction }) => {
    const res = await signAndExecute({ transaction });
    return { digest: res.digest };
  };
  const verifySign: SignPersonalMessage = async ({ message }) => {
    const res = await signPersonalMessage({ message });
    return { signature: res.signature };
  };

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
          <div className="masthead-actions">
            <div className="settings" ref={settingsRef}>
              <button
                className="settings-btn"
                onClick={() => setSettingsOpen((o) => !o)}
                aria-label="Settings"
                aria-expanded={settingsOpen}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              {settingsOpen && (
                <div className="settings-card">
                  <span className="settings-title">Settings</span>
                  <label className="settings-row">
                    <span>
                      Developer mode
                      <em>register agents, simulate, grant access</em>
                    </span>
                    <span className="switch">
                      <input
                        type="checkbox"
                        checked={mode === "build"}
                        onChange={(e) => setMode(e.target.checked ? "build" : "verify")}
                      />
                      <span className="switch-track" />
                    </span>
                  </label>
                  <label className="settings-row">
                    <span>Mute sound</span>
                    <span className="switch">
                      <input
                        type="checkbox"
                        checked={soundMuted}
                        onChange={(e) => setSoundMuted(e.target.checked)}
                      />
                      <span className="switch-track" />
                    </span>
                  </label>
                </div>
              )}
            </div>
            <WalletConnect />
          </div>
        </div>
        <p className="lede">
          {mode === "verify" ? (
            <>
              The AI agent you use moves your money and asks you to trust it. Don't,{" "}
              <strong>verify it</strong>. Plug it in below and see exactly what it did, why, and
              that it stayed within your limits. Proven, not promised.
            </>
          ) : (
            <>
              Build agents whose every action is provable. With the Avow SDK your agent records
              and seals each action it takes; <strong>set the rules, run it, and verify</strong>,
              all testable right here.
            </>
          )}
        </p>
        {mode === "build" && (
          <span className="mode-flag">developer mode on</span>
        )}
      </header>

      {mode === "build" && (
      <section className={`how hud${started ? " play" : ""}`}>
        <div className="how-step">
          <span className="how-n">1</span>
          <div>
            <h3>You set the rules</h3>
            <p>Decide what your agent is allowed to do: how much it can move, where, and for how long.</p>
          </div>
        </div>
        <div className="how-step">
          <span className="how-n">2</span>
          <div>
            <h3>The agent acts, and proves it</h3>
            <p>
              Each time it acts, it saves what it did and why, and locks in a proof. An action
              that breaks your rules can't make a proof, so it can't hide it.
            </p>
          </div>
        </div>
        <div className="how-step">
          <span className="how-n">3</span>
          <div>
            <h3>Anyone you allow can check</h3>
            <p>
              Open any action to see what it did, why, and that it stayed within your rules.
              No trust needed.
            </p>
          </div>
        </div>
      </section>
      )}

      {mode === "build" && (
      <section className="setup">
        <span className="label">Register an agent</span>
        {!account ? (
          <p className="finder-hint">
            Connect your wallet (top right) to register an agent. You become the owner, and you
            can leave the agent address blank to use this same wallet as the agent.
          </p>
        ) : (
          <>
            <p className="finder-hint">
              Name your agent's wallet and set its limits. Leave the address blank and your
              connected wallet becomes the agent, the quickest way to try it.
            </p>
            {!setupOpen && (
              <button className="btn-green" onClick={() => setSetupOpen(true)}>
                Register an agent
              </button>
            )}
            {setupOpen && (
              <div className="setup-body hud">
                <div className="setup-grid">
                  <label>
                    <span>Agent address</span>
                    <input
                      value={setupAgent}
                      placeholder={account.address}
                      spellCheck={false}
                      onChange={(e) => setSetupAgent(e.target.value)}
                    />
                    <em className="field-hint">
                      Your agent's own wallet (the key its code signs with). Leave blank to use
                      this wallet as the agent.
                    </em>
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
                <div className="setup-actions">
                  <button
                    className="btn-green"
                    onClick={onSetup}
                    disabled={setupState.status === "running"}
                    style={{ padding: "10px 18px" }}
                  >
                    {setupState.status === "running" ? "creating…" : "Create mandate"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => setSetupOpen(false)}
                    disabled={setupState.status === "running"}
                  >
                    Cancel
                  </button>
                </div>
                {setupState.status === "ok" && setupState.result && (
                  <div className="verify-result ok">
                    <strong>Created and loaded below.</strong> mandate{" "}
                    {short(setupState.result.mandateId)} · access{" "}
                    {short(setupState.result.accessId)}. You are the agent, so you can create a
                    live proof in the panel below.
                  </div>
                )}
                {setupState.status === "fail" && (
                  <div className="verify-result fail">{setupState.error}</div>
                )}
              </div>
            )}
          </>
        )}
      </section>
      )}

      <section className="finder">
        <label className="label" htmlFor="mandate">
          Inspect an agent
        </label>

        {account && myMandates.length > 0 && (
          <>
            <p className="finder-hint">
              Your agents, the ones this wallet owns. Pick one to see and verify what it has done.
            </p>
            <div className="demo-agents">
              {myMandates.map((m, i) => (
                <button
                  key={m}
                  className={`demo-pill${mandateId === m ? " is-on" : ""}`}
                  onClick={() => {
                    setInput("");
                    setMandateId(m);
                  }}
                  title={`Agent id: ${m}`}
                >
                  Agent {i + 1}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="finder-hint">
          {account && myMandates.length > 0 ? (
            <>
              Or try one of ours, or paste any{" "}
              <span
                className="help"
                title="An agent id is its mandate id: the on-chain rulebook and identity Avow gave the agent when it was registered. Every action it records is tied to this id, so pasting it loads that agent's full, provable history."
              >
                agent id
              </span>
              .
            </>
          ) : (
            <>
              Connect your wallet (top right) to see your own agents, or try one of ours below.
              Either way, you verify what the agent did, you never just trust it.
            </>
          )}
        </p>
        <div className="demo-agents">
          {DEMO_AGENTS.map((a) => (
            <button
              key={a.mandateId}
              className={`demo-pill${mandateId === a.mandateId ? " is-on" : ""}`}
              onClick={() => {
                setInput("");
                setMandateId(a.mandateId);
              }}
              title={a.blurb}
            >
              {a.name}
            </button>
          ))}
        </div>
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

      {mode === "build" && capId && (
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
          <span className="stat-label">total moved across all actions</span>
        </div>
      </section>

      {mandate && records.length > 0 && (
        <div className="verdict hud">
          <span className="verdict-mark">✓</span>
          <p>
            <strong>Every action your agent took stayed within your limits.</strong> All {moves}{" "}
            were inside the {group(mandate.perMoveCap)} per-action limit you set. Avow checks that
            limit the moment each action is recorded, so one that broke your rules could never have
            been saved here. Open any action below to see exactly what it did, and why, you never
            have to take its word for it.
          </p>
        </div>
      )}

      <AgentRun
        records={records}
        account={account?.address}
        verifySign={verifySign}
        perMoveCap={mandate?.perMoveCap ?? null}
        canAnchor={youAreAgent}
        showAnchor={mode === "build"}
        connected={!!account}
        agentAddress={account?.address}
        mandateId={mandateId}
        accessId={liveAccessId}
        signAndExecute={runAnchor}
        onAnchored={() => load(mandateId)}
      />

      <div className="records-head reveal">
        <span className="records-title">Track record</span>
        <span className="note mono">{short(mandateId, 8, 6)}</span>
      </div>
      <p className="records-intro reveal">
        Everything your agent has done, newest first. You see the result, and you can open any one
        to see how it did it, why, and that it stayed within your limits. No trust needed.
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
        {pageRecords.map((r, idx) => {
          const i = page * PER_PAGE + idx;
          const key = r.txDigest ?? r.blobId;
          const v = verify[key] ?? { status: "idle" as VerifyStatus };
          return (
            <li className="record" key={key} style={{ animationDelay: `${idx * 40}ms` }}>
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
                    <strong>Verified. This action obeyed your rules.</strong>
                    <div className="reveal-block">
                      <span className="reveal-k">unaltered</span>
                      <p className="reveal-why">
                        the sealed evidence matches the fingerprint stamped on chain, nothing was
                        changed after the fact.
                      </p>
                    </div>
                    {mandate && (
                      <div className="reveal-block">
                        <span className="reveal-k">within the limit</span>
                        <p className="reveal-why">
                          it moved {group(r.amount)}; the limit is {group(mandate.perMoveCap)} per
                          action.{" "}
                          {BigInt(r.amount || "0") <= BigInt(mandate.perMoveCap)
                            ? "Inside the limit ✓"
                            : "over the limit"}
                          . An over-limit action could not have produced this proof at all.
                        </p>
                      </div>
                    )}
                    {describeObserved(v.observed).length > 0 && (
                      <div className="reveal-block">
                        <span className="reveal-k">what it saw</span>
                        <ul className="reveal-list">
                          {describeObserved(v.observed).map((line, j) => (
                            <li key={j}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {v.rationale && (
                      <div className="reveal-block">
                        <span className="reveal-k">why it acted</span>
                        <p className="reveal-why">“{v.rationale}”</p>
                      </div>
                    )}
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

      {pageCount > 1 && (
        <div className="pager">
          <button
            className="btn-ghost"
            disabled={page === 0}
            onClick={() => setRecordsPage(page - 1)}
          >
            Prev
          </button>
          <span className="pager-at">
            page {page + 1} of {pageCount} · {records.length} records
          </span>
          <button
            className="btn-ghost"
            disabled={page >= pageCount - 1}
            onClick={() => setRecordsPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}

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
              SDK
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
