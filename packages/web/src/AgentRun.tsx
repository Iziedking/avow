// See a proof for real. The console runs the actual verification of an anchored record: read
// the sealed evidence from Walrus, prove you are an authorized reader, let Seal release the
// key, decrypt, recompute the fingerprint, match the on-chain anchor, and reveal the agent's
// real reasoning. Nothing here is simulated. When the connected wallet is the agent, the finale
// also creates one genuine proof on the spot.

import { useCallback, useRef, useState } from "react";
import { beep } from "./beep";
import { anchorLive, type SignAndExecute, type LiveAction } from "./anchorLive";
import { verifyRecord, type SignPersonalMessage } from "./verify";
import { describeObserved } from "./reveal";
import type { AnchoredRecord } from "./records";
import { SUISCAN } from "./config";

type LineKind = "head" | "data" | "think" | "move" | "hold" | "proof" | "done";
interface Line {
  text: string;
  kind: LineKind;
}

// Each kind reads out at its own pitch, so the console chatters as it works.
const KIND_HZ: Record<LineKind, number> = {
  head: 600,
  data: 720,
  think: 520,
  move: 880,
  hold: 440,
  proof: 800,
  done: 990,
};

export interface AgentRunProps {
  records: AnchoredRecord[];
  account?: string;
  verifySign: SignPersonalMessage;
  /** The mandate's per-action limit, to show the rule check. */
  perMoveCap?: string | null;
  /** True when the connected wallet is the agent named in the loaded mandate. */
  canAnchor: boolean;
  connected: boolean;
  agentAddress?: string;
  mandateId: string;
  accessId: string | null;
  signAndExecute: SignAndExecute;
  onAnchored: () => void;
}

function fmt(n: string): string {
  return /^\d+$/.test(n) ? n.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : n;
}

export function AgentRun(props: AgentRunProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const push = useCallback((line: Line) => {
    setLines((ls) => [...ls, line]);
    beep(KIND_HZ[line.kind]);
  }, []);

  const latest = props.records[0];

  const verifyLatest = useCallback(async () => {
    if (!latest || !props.account) return;
    const id = ++seq.current;
    setBusy(true);
    setLines([]);
    const alive = () => seq.current === id;
    const add = (line: Line) => {
      if (alive()) {
        setLines((ls) => [...ls, line]);
        beep(KIND_HZ[line.kind]);
      }
    };

    add({ text: `verifying the latest proof`, kind: "head" });
    try {
      const out = await verifyRecord(latest, props.account, props.verifySign, (m) =>
        add({ text: m, kind: "think" }),
      );
      if (!alive()) return;
      if (out.hashMatches) {
        add({ text: `verified. this action obeyed your rules.`, kind: "head" });
        add({ text: `unaltered   the evidence matches the fingerprint on chain`, kind: "proof" });
        if (props.perMoveCap) {
          const within = BigInt(latest.amount || "0") <= BigInt(props.perMoveCap);
          add({
            text: `within limit   moved ${fmt(latest.amount)}, limit ${fmt(props.perMoveCap)} per action ${within ? "✓" : "over"}`,
            kind: within ? "data" : "hold",
          });
        }
        add({ text: `unsealed, this is what the agent actually recorded:`, kind: "head" });
        for (const line of describeObserved(out.bundle?.observed)) {
          add({ text: `saw   ${line}`, kind: "data" });
        }
        if (out.rationale) add({ text: `why   ${out.rationale}`, kind: "move" });
      } else {
        add({
          text: `the recomputed fingerprint did not match. this record does not verify.`,
          kind: "hold",
        });
      }
    } catch (e) {
      add({
        text: `cannot reveal: ${e instanceof Error ? e.message : String(e)}`,
        kind: "hold",
      });
      add({
        text: `if it says no access, you are not an authorized reader. the owner can grant you.`,
        kind: "hold",
      });
    } finally {
      if (alive()) setBusy(false);
    }
  }, [latest, props.account, props.verifySign]);

  const anchorOne = useCallback(async () => {
    if (!props.canAnchor || !props.accessId || !props.agentAddress) return;
    setBusy(true);
    push({ text: `creating a real proof, live`, kind: "head" });

    const action: LiveAction = {
      agent: props.agentAddress,
      actionType: "yield_move",
      target: "navi",
      amount: "100000",
      rationale:
        "Ignored degenpool (9.20% APY, risk 320bps) for exceeding the 150bps risk limit. " +
        "Moved to navi: a risk-adjusted 5.05% (5.30% APY minus 25bps risk) is the best safe yield.",
      observed: {
        rates: [
          { target: "navi", apyBps: 530, riskBps: 25 },
          { target: "scallop", apyBps: 415, riskBps: 60 },
          { target: "degenpool", apyBps: 920, riskBps: 320 },
        ],
      },
    };

    try {
      const result = await anchorLive({
        address: props.agentAddress,
        mandateId: props.mandateId,
        accessId: props.accessId,
        action,
        signAndExecute: props.signAndExecute,
        onStep: (m) => push({ text: m, kind: "think" }),
      });
      push({ text: `proof anchored ✓  ${SUISCAN}/tx/${result.anchorDigest}`, kind: "proof" });
      push({ text: `it's in the track record now. verify it above to reveal the reasoning.`, kind: "done" });
      props.onAnchored();
    } catch (e) {
      push({
        text: `could not anchor: ${e instanceof Error ? e.message : String(e)}`,
        kind: "hold",
      });
    } finally {
      setBusy(false);
    }
  }, [props, push]);

  const canVerify = !!props.account && !!latest && !busy;

  return (
    <section className="run hud">
      <div className="run-bar">
        <div>
          <span className="run-title">See a proof</span>
          <p className="run-sub">
            This verifies the most recent proof and unseals its reasoning, live. To verify a
            specific one, use the Verify button on any record in the track record below.
          </p>
        </div>
        <button className="btn-green run-btn" onClick={verifyLatest} disabled={!canVerify}>
          {busy ? "working…" : lines.length ? "Verify again" : "Verify the latest proof"}
        </button>
      </div>

      <div className="run-console" aria-live="polite">
        {lines.length === 0 ? (
          <span className="run-idle">
            {!props.account
              ? "> connect a wallet, then verify a proof to reveal it."
              : !latest
                ? "> no proofs to verify on this mandate yet."
                : "> press verify to unseal the latest proof, for real."}
          </span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`run-line run-${l.kind}`}>
              {l.kind === "head" ? l.text : <span className="run-arrow">›</span>}
              {l.kind !== "head" && ` ${l.text}`}
            </div>
          ))
        )}
        {busy && <span className="run-cursor" />}
      </div>

      {props.canAnchor ? (
        <div className="run-finale">
          <button className="btn-green" onClick={anchorOne} disabled={busy}>
            Create a real proof, live
          </button>
          <span className="run-finale-hint">
            You are the agent of this mandate. This signs three times in your wallet (Walrus
            register, certify, then anchor) and uses a little testnet SUI and WAL. The new proof
            appears in the track record, then verify it above.
          </span>
        </div>
      ) : props.connected ? (
        <p className="run-note">
          This mandate's agent is a different wallet, so its actions are recorded by the agent's
          own code through the SDK or CLI. Connected here you are the owner or an auditor: you
          verify and reveal. To create a live proof yourself, register an agent with this wallet.
        </p>
      ) : null}
    </section>
  );
}
