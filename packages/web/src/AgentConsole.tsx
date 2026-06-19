// The Agent console (Model C): a computer-screen terminal where a real user claims a personal
// DeepBook trading agent, funds it with SUI, and instructs it in plain English. The agent signs
// its own trades (autonomous) and, being built with the Avow SDK, grants the connecting wallet
// read access. The console stays terse, it confirms the action; the full reasoning lives on the
// Avow home, decryptable by the wallet you used. Stored on Walrus, tamper-proof, forever.

import { useEffect, useRef, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { beep } from "./beep";
import { WalletConnect } from "./WalletConnect";

const AGENT_API =
  (import.meta.env.VITE_AGENT_API as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8787";
const NEED_SUI = 1.5; // the user funds at least this much trading capital

type LineKind = "cmd" | "sys" | "reply" | "outcome" | "proof" | "err";
interface Line {
  kind: LineKind;
  text: string;
  href?: string; // when set, the line renders as a link (e.g. the on-chain proof)
}
const HZ: Record<LineKind, number> = { cmd: 600, sys: 520, reply: 720, outcome: 990, proof: 800, err: 300 };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function AgentConsole() {
  const account = useCurrentAccount();
  const [agent, setAgent] = useState<{ address: string; mandate: string } | null>(null);
  const [funded, setFunded] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [copied, setCopied] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);

  const add = (kind: LineKind, text: string, href?: string) => {
    setLines((ls) => [...ls, { kind, text, href }]);
    beep(HZ[kind]);
  };
  const api = async (path: string, body: unknown) => {
    const res = await fetch(`${AGENT_API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  };
  useEffect(() => {
    screenRef.current?.scrollTo({ top: screenRef.current.scrollHeight });
  }, [lines]);

  // When a wallet connects, restore the agent it already claimed (persisted server-side) so the
  // user picks up where they left off. The agent is tied to your identity, so disconnect clears it.
  useEffect(() => {
    setAgent(null);
    setFunded(false);
    setLines([]);
    setCopied(false);
    if (!account) return;
    let cancelled = false;
    (async () => {
      try {
        const out = await api("/my-agent", { owner: account.address });
        if (cancelled || !out?.agentAddress) return;
        setAgent({ address: out.agentAddress, mandate: out.mandateId });
        const { sui } = await api("/balance", { agentAddress: out.agentAddress });
        if (cancelled) return;
        if (sui >= NEED_SUI) {
          setFunded(true);
          add("sys", `your agent is active — ${Number(sui).toFixed(2)} SUI ready. tell it what to do.`);
        } else {
          add("sys", `your agent is active. fund it: send ~${NEED_SUI} SUI, then press "check".`);
        }
      } catch {
        // backend offline; the user can still claim once it is running.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.address]);

  async function claim() {
    if (!account || busy) return;
    setBusy(true);
    setLines([]);
    add("cmd", `${short(account.address)}@avow:~$ claim a deepbook agent`);
    add("sys", "spinning up your personal agent and granting your wallet…");
    try {
      const out = await api("/claim", { owner: account.address });
      if (out.error) return add("err", out.error);
      setAgent({ address: out.agentAddress, mandate: out.mandateId });
      add("sys", `agent ready: ${out.agentAddress}`);
      add("sys", `fund it: send ~${NEED_SUI} SUI to that address, then press "check".`);
    } catch {
      add("err", `agent unreachable at ${AGENT_API}. start it: npx tsx packages/agent/scripts/agent-server.ts`);
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!agent || busy) return;
    setBusy(true);
    try {
      const { sui } = await api("/balance", { agentAddress: agent.address });
      if (sui >= NEED_SUI) {
        setFunded(true);
        add("sys", `funded with ${Number(sui).toFixed(2)} SUI. tell the agent what to do.`);
      } else {
        add("sys", `balance ${Number(sui).toFixed(2)} SUI. send a little more (>= ${NEED_SUI}).`);
      }
    } catch {
      add("err", "could not read the balance.");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    const text = instruction.trim();
    if (!text || busy || !agent) return;
    setBusy(true);
    add("cmd", `${short(account!.address)}@avow:~$ ${text}`);
    add("sys", "agent recalling its memory and reading the market…");
    try {
      const out = await api("/agent", { mandateId: agent.mandate, instruction: text });
      if (out.error) add("err", out.error);
      else {
        if (out.reply) add("reply", out.reply); // the agent talking back
        const steps = (out.steps as string[] | undefined) ?? [];
        for (const s of steps) add("outcome", `✓ ${s}`);
        if (out.swapUrl) add("proof", "on-chain ↗ view on SuiScan", out.swapUrl);
        if (steps.length) add("sys", "verify the full reasoning on Avow ▾");
      }
    } catch {
      add("err", "agent unreachable. is the backend running?");
    } finally {
      setBusy(false);
      setInstruction("");
    }
  }

  const status = busy ? "working" : !account ? "no wallet" : !agent ? "no agent" : funded ? "ready" : "fund me";

  return (
    <div className="ac">
      <div className="ac-screen hud" ref={screenRef}>
        <div className="ac-bar">
          <span>AVOW · DEEPBOOK AGENT</span>
          <div className="ac-bar-right">
            <span>{status}</span>
            <WalletConnect />
          </div>
        </div>

        <div className="ac-log">
          {lines.length === 0 && (
            <div className="ac-idle">
              {!account ? (
                <>
                  <p>{"> connect a wallet to claim your own DeepBook trading agent."}</p>
                  <p className="ac-dim">{"> your wallet is your identity, the only key that decrypts what it does."}</p>
                </>
              ) : (
                <>
                  <p>{"> claim a personal agent, fund it with SUI, then instruct it in plain English."}</p>
                  <p className="ac-dim">{"> it trades on DeepBook for real and proves every action on Avow."}</p>
                </>
              )}
            </div>
          )}
          {lines.map((l, i) =>
            l.href ? (
              <a key={i} className={`ac-line ac-${l.kind} ac-anchor`} href={l.href} target="_blank" rel="noreferrer">
                {l.text}
              </a>
            ) : (
              <div key={i} className={`ac-line ac-${l.kind}`}>
                {l.text}
              </div>
            ),
          )}
          {agent && !funded && (
            <div className="ac-fund">
              <span className="ac-dim">fund your agent ▸</span>
              <code>{agent.address}</code>
              <button
                className={`ac-mini${copied ? " is-copied" : ""}`}
                onClick={() => {
                  navigator.clipboard?.writeText(agent.address);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? "copied ✓" : "copy"}
              </button>
            </div>
          )}
          {busy && <span className="ac-cursor" />}
        </div>

        {/* The action row changes with where you are in the flow. */}
        {!account ? (
          <div className="ac-prompt">
            <span className="ac-ps1">guest@avow:~$</span>
            <span className="ac-dim ac-input">connect a wallet to begin</span>
          </div>
        ) : !agent ? (
          <div className="ac-prompt">
            <span className="ac-ps1">{short(account.address)}@avow:~$</span>
            <span className="ac-input ac-dim">claim your DeepBook agent</span>
            <button className="ac-run" onClick={claim} disabled={busy}>
              {busy ? "…" : "claim ▸"}
            </button>
          </div>
        ) : !funded ? (
          <div className="ac-prompt">
            <span className="ac-ps1">{short(account.address)}@avow:~$</span>
            <span className="ac-input ac-dim">send SUI to the address above, then check</span>
            <button className="ac-run" onClick={check} disabled={busy}>
              {busy ? "…" : "check ▸"}
            </button>
          </div>
        ) : (
          <form
            className="ac-prompt"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <span className="ac-ps1">{short(account.address)}@avow:~$</span>
            <input
              className="ac-input"
              value={instruction}
              placeholder="tell the agent what to do…"
              spellCheck={false}
              autoFocus
              disabled={busy}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <button className="ac-run" type="submit" disabled={busy || !instruction.trim()}>
              {busy ? "…" : "run ▸"}
            </button>
          </form>
        )}
      </div>

      <div className="ac-foot">
        {agent ? (
          <a className="ac-verify" href={`/?app&mandate=${agent.mandate}`}>
            verify on Avow ▸ connect this same wallet, your records decrypt for you alone
          </a>
        ) : (
          <span className="ac-dim">the agent signs its own trades; you verify on Avow with the wallet you used.</span>
        )}
      </div>
    </div>
  );
}
