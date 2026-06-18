// Watch the agent work, then anchor one real proof. The playback narrates the reference yield
// agent's real decision logic over six cycles (front-end only, an example of what it does, so it
// never stalls in a demo). When the connected wallet is the agent of the loaded mandate, the
// finale creates one genuine proof on the spot, signed by that wallet, and it appears below.

import { useCallback, useRef, useState } from "react";
import { beep } from "./beep";
import { anchorLive, type SignAndExecute, type LiveAction } from "./anchorLive";
import { SUISCAN } from "./config";

interface Cycle {
  navi: number;
  scallop: number;
}

// Yields in basis points, the run that produced the records below. 100bps = 1.00%.
const SCENARIO: Cycle[] = [
  { navi: 530, scallop: 415 },
  { navi: 470, scallop: 545 },
  { navi: 505, scallop: 530 },
  { navi: 560, scallop: 520 },
  { navi: 640, scallop: 500 },
  { navi: 600, scallop: 590 },
];
const THRESHOLD = 50;

type LineKind = "head" | "data" | "think" | "move" | "hold" | "proof" | "done";
interface Line {
  text: string;
  kind: LineKind;
}

// Each kind of line reads out at its own pitch, so the console chatters as it loads.
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
  /** True when the connected wallet is the agent named in the loaded mandate. */
  canAnchor: boolean;
  /** True when any wallet is connected. */
  connected: boolean;
  agentAddress?: string;
  mandateId: string;
  accessId: string | null;
  signAndExecute: SignAndExecute;
  onAnchored: () => void;
}

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function AgentRun(props: AgentRunProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [anchoring, setAnchoring] = useState(false);
  const runId = useRef(0);

  const push = useCallback((line: Line) => {
    setLines((ls) => [...ls, line]);
    beep(KIND_HZ[line.kind]);
  }, []);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setRunning(true);
    setLines([]);

    const alive = () => runId.current === id;
    const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    const add = (line: Line) => {
      if (!alive()) return;
      setLines((ls) => [...ls, line]);
      beep(KIND_HZ[line.kind]);
    };

    let current = "idle";
    let currentApy = 0;
    let moves = 0;

    for (let i = 0; i < SCENARIO.length && alive(); i++) {
      const c = SCENARIO[i];
      add({ text: `cycle ${String(i + 1).padStart(2, "0")}`, kind: "head" });
      await wait(700);

      add({ text: `reading yields from each protocol…`, kind: "think" });
      await wait(700);
      add({ text: `navi ${pct(c.navi)}    scallop ${pct(c.scallop)}`, kind: "data" });
      await wait(800);

      const best = c.navi >= c.scallop ? "navi" : "scallop";
      const bestApy = Math.max(c.navi, c.scallop);
      add({
        text: `best yield is ${best} at ${pct(bestApy)}, currently in ${current} at ${pct(currentApy)}`,
        kind: "think",
      });
      await wait(800);

      const gain = bestApy - currentApy;
      if (best === current) {
        add({ text: `HOLD: already in the best yield, nothing to do`, kind: "hold" });
      } else if (gain < THRESHOLD) {
        add({
          text: `HOLD: only a ${gain}bps gain, under the ${THRESHOLD}bps rule, not worth it`,
          kind: "hold",
        });
      } else {
        moves += 1;
        add({
          text: `MOVE ${current} → ${best}: a ${gain}bps gain, clears the ${THRESHOLD}bps rule`,
          kind: "move",
        });
        await wait(650);
        add({ text: `sealing the evidence · storing on Walrus · proof on chain ✓`, kind: "proof" });
        current = best;
        currentApy = bestApy;
      }
      await wait(950);
    }

    if (alive()) {
      add({
        text: `done. ${moves} moves, each sealed and proven. open any in the track record below and verify it yourself.`,
        kind: "done",
      });
      setRunning(false);
    }
  }, []);

  const anchorOne = useCallback(async () => {
    if (!props.canAnchor || !props.accessId || !props.agentAddress) return;
    setAnchoring(true);
    push({ text: `create a real proof, live`, kind: "head" });

    const action: LiveAction = {
      agent: props.agentAddress,
      actionType: "yield_move",
      target: "navi",
      amount: "100000",
      rationale: "Live proof from the dashboard: moved to navi, the best yield this cycle.",
      observed: {
        rates: [
          { target: "navi", apyBps: 530 },
          { target: "scallop", apyBps: 415 },
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
      push({ text: `it's in the track record below now. open it and verify.`, kind: "done" });
      props.onAnchored();
    } catch (e) {
      push({
        text: `could not anchor: ${e instanceof Error ? e.message : String(e)}`,
        kind: "hold",
      });
    } finally {
      setAnchoring(false);
    }
  }, [props, push]);

  return (
    <section className="run hud">
      <div className="run-bar">
        <div>
          <span className="run-title">Watch the agent work</span>
          <p className="run-sub">
            An example of how it reads the yields, compares them, and decides, the same run that
            produced the proofs below.
          </p>
        </div>
        <button className="btn-green run-btn" onClick={run} disabled={running || anchoring}>
          {running ? "running…" : lines.length ? "Run again" : "Run the agent"}
        </button>
      </div>

      <div className="run-console" aria-live="polite">
        {lines.length === 0 ? (
          <span className="run-idle">{"> agent idle. press run."}</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`run-line run-${l.kind}`}>
              {l.kind === "head" ? l.text : <span className="run-arrow">›</span>}
              {l.kind !== "head" && ` ${l.text}`}
            </div>
          ))
        )}
        {(running || anchoring) && <span className="run-cursor" />}
      </div>

      {props.canAnchor ? (
        <div className="run-finale">
          <button className="btn-green" onClick={anchorOne} disabled={anchoring || running}>
            {anchoring ? "anchoring…" : "Create a real proof, live"}
          </button>
          <span className="run-finale-hint">
            You are the agent of this mandate. This signs three times in your wallet (Walrus
            register, certify, then anchor) and uses a little testnet SUI and WAL. The new proof
            appears below.
          </span>
        </div>
      ) : props.connected ? (
        <p className="run-note">
          This mandate's agent is a different wallet, so its actions are recorded by the agent's
          own code through the SDK or CLI. Connected here you are the owner or an auditor: you
          view and verify. To create a live proof yourself, register an agent with this wallet.
        </p>
      ) : null}
    </section>
  );
}
