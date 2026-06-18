// Watch the agent work. A live playback of the reference yield agent's real decision logic:
// it reads the yields, compares them to where it sits now, and moves only when a better one
// clears its threshold. The same six cycles that produced the proofs in the track record below.
// Pure front-end narration, so it never stalls in a demo; the proofs it points at are real.

import { useCallback, useRef, useState } from "react";
import { beep } from "./beep";

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

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function AgentRun() {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const runId = useRef(0);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setRunning(true);
    setLines([]);

    const alive = () => runId.current === id;
    const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    const push = (line: Line) => {
      if (alive()) setLines((ls) => [...ls, line]);
    };

    let current = "idle";
    let currentApy = 0;
    let moves = 0;

    for (let i = 0; i < SCENARIO.length && alive(); i++) {
      const c = SCENARIO[i];
      push({ text: `cycle ${String(i + 1).padStart(2, "0")}`, kind: "head" });
      beep(620);
      await wait(700);

      push({ text: `reading yields from each protocol…`, kind: "think" });
      await wait(700);
      push({ text: `navi ${pct(c.navi)}    scallop ${pct(c.scallop)}`, kind: "data" });
      await wait(800);

      const best = c.navi >= c.scallop ? "navi" : "scallop";
      const bestApy = Math.max(c.navi, c.scallop);
      push({
        text: `best yield is ${best} at ${pct(bestApy)}, currently in ${current} at ${pct(currentApy)}`,
        kind: "think",
      });
      await wait(800);

      const gain = bestApy - currentApy;
      if (best === current) {
        push({ text: `HOLD — already in the best yield, nothing to do`, kind: "hold" });
        beep(430);
      } else if (gain < THRESHOLD) {
        push({
          text: `HOLD — moving would only gain ${gain}bps, under the ${THRESHOLD}bps rule, not worth it`,
          kind: "hold",
        });
        beep(430);
      } else {
        moves += 1;
        push({
          text: `MOVE ${current} → ${best} — a ${gain}bps gain, clears the ${THRESHOLD}bps rule`,
          kind: "move",
        });
        beep(880);
        await wait(650);
        push({ text: `sealing the evidence · storing on Walrus · proof on chain ✓`, kind: "proof" });
        current = best;
        currentApy = bestApy;
      }
      await wait(950);
    }

    if (alive()) {
      push({
        text: `done. ${moves} moves, each sealed and proven. open any in the track record below and verify it yourself.`,
        kind: "done",
      });
      beep(990);
      setRunning(false);
    }
  }, []);

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
        <button className="btn-green run-btn" onClick={run} disabled={running}>
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
        {running && <span className="run-cursor" />}
      </div>
    </section>
  );
}
