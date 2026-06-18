// The decision policy. Deliberately simple and legible, but risk-aware: a pool whose risk
// exceeds the limit is ignored no matter how high its yield, and among the rest the agent
// compares risk-adjusted yield (apy minus risk) and moves only when a different target beats
// the current one by more than the threshold. The point of Avow is the provable record and the
// readable reasoning, not the alpha, so the rationale spells out the whole decision.

import type { Observation, Decision, RateQuote } from "./money";

export interface Policy {
  /** Minimum risk-adjusted improvement, in bps, before the agent will move. */
  thresholdBps: number;
  /** Pools with a risk score above this are ignored, whatever their yield. */
  maxRiskBps: number;
}

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function riskAdjusted(r: RateQuote): number {
  return r.apyBps - r.riskBps;
}

export function decide(obs: Observation, policy: Policy): Decision {
  const { thresholdBps, maxRiskBps } = policy;
  const current = obs.current;

  const safe = obs.rates.filter((r) => r.riskBps <= maxRiskBps);
  const excluded = obs.rates.filter((r) => r.riskBps > maxRiskBps && r.target !== "idle");

  const currentQuote = obs.rates.find((r) => r.target === current.target);
  const currentAdj = currentQuote ? riskAdjusted(currentQuote) : 0;

  const best = safe.reduce((a, b) => (riskAdjusted(b) > riskAdjusted(a) ? b : a));
  const bestAdj = riskAdjusted(best);
  const improvement = bestAdj - currentAdj;

  const skipped = excluded
    .map((e) => `${e.target} (${pct(e.apyBps)} APY, risk ${e.riskBps}bps)`)
    .join(", ");
  const riskNote = excluded.length
    ? `Ignored ${skipped} for exceeding the ${maxRiskBps}bps risk limit. `
    : "";

  if (best.target === current.target || improvement < thresholdBps) {
    return {
      move: false,
      actionType: "yield_move",
      fromTarget: current.target,
      toTarget: current.target,
      amount: "0",
      rationale:
        riskNote +
        `Best safe pool is ${best.target} at a risk-adjusted ${pct(bestAdj)}, which does not ` +
        `beat ${current.target} at ${pct(currentAdj)} by the ${thresholdBps}bps threshold. Held.`,
      observed: obs.rates,
    };
  }

  return {
    move: true,
    actionType: "yield_move",
    fromTarget: current.target,
    toTarget: best.target,
    amount: current.amount,
    rationale:
      riskNote +
      `Moved ${current.target} to ${best.target}: a risk-adjusted ${pct(bestAdj)} ` +
      `(${pct(best.apyBps)} APY minus ${best.riskBps}bps risk) beats ${current.target} at ` +
      `${pct(currentAdj)} by ${improvement}bps, clearing the ${thresholdBps}bps threshold.`,
    observed: obs.rates,
  };
}
