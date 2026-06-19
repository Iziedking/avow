// The reasoning-flow view: how an agent thought its way to one action, revealed only after the
// sealed evidence is decrypted and its hash verified against the on-chain anchor. The goal sits
// at the top, the ordered steps run down a timeline, the outcome at the bottom. This is the
// thing that turns "prove the action" into "prove the reasoning behind it".

export type ReasoningStepKind = "observe" | "think" | "tool" | "decide";

export interface ReasoningStep {
  kind: ReasoningStepKind;
  title: string;
  detail?: string;
  data?: unknown;
}

export interface ReasoningTrace {
  goal: string;
  steps: ReasoningStep[];
  outcome: string;
}

const KIND_LABEL: Record<ReasoningStepKind, string> = {
  observe: "Observed",
  think: "Considered",
  tool: "Ran",
  decide: "Decided",
};

function formatData(data: unknown): string {
  try {
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export function ReasoningFlow({ trace }: { trace: ReasoningTrace }) {
  return (
    <div className="reasoning">
      <div className="reasoning-cap">
        <span className="reasoning-k">Goal</span>
        <p className="reasoning-goal">{trace.goal}</p>
      </div>

      <ol className="reasoning-steps">
        {trace.steps.map((s, i) => (
          <li key={i} className={`rstep rstep-${s.kind}`}>
            <span className="rstep-node" aria-hidden="true" />
            <div className="rstep-body">
              <span className="rstep-kind">{KIND_LABEL[s.kind]}</span>
              <p className="rstep-title">{s.title}</p>
              {s.detail && <p className="rstep-detail">{s.detail}</p>}
              {s.data != null && s.data !== "" && (
                <pre className="rstep-data">{formatData(s.data)}</pre>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="reasoning-cap reasoning-out">
        <span className="reasoning-k">Outcome</span>
        <p className="reasoning-goal">{trace.outcome}</p>
      </div>
    </div>
  );
}
