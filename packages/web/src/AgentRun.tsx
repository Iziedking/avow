// Watch the agent work, then anchor one real proof. The playback narrates the reference yield
// agent's real decision logic over six cycles (front-end only, so it never stalls in a demo).
// When the connected wallet is the agent of the loaded mandate, the finale creates one genuine
// proof on the spot, signed by that wallet, and it appears in the track record below.

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

export interface AgentRunProps {
  /** True when the connected wallet is the agent named in the loaded mandate. */
  canAnchor: boolean;
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

  const push = useCallback((line: Line) => setLines((ls) => [...ls, line]), []);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setRunning(true);
    setLines([]);

    const alive = () => runId.current === id;
    const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    const add = (line: Line) => {
      if (alive()) setLines((ls) => [...ls, line]);
    };

    let current = "idle";
    let currentApy = 0;
    let moves = 0;

    for (let i = 0; i < SCENARIO.length && alive(); i++) {
      const c = SCENARIO[i];
      add({ text: `cycle ${String(i + 1).padStart(2, "0")}`, kind: "head" });
      beep(620);
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
        add({ text: `HOLD — already in the best yield, nothing to do`, kind: "hold" });
        beep(430);
      } else if (gain < THRESHOLD) {
        add({
          text: `HOLD — moving would only gain ${gain}bps, under the ${THRESHOLD}bps rule, not worth it`,
          kind: "hold",
        });
        beep(430);
      } else {
        moves += 1;
        add({
          text: `MOVE ${current} → ${best} — a ${gain}bps gain, clears the ${THRESHOLD}bps rule`,
          kind: "move",
        });
        beep(880);
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
      beep(990);
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
      beep(990);
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
            See how it reads the yields, compares them, and decides, the same run that produced
            the proofs below.
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

      {props.canAnchor && (
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
      )}
    </section>
  );
}
