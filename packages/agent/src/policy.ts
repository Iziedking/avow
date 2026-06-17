// The decision policy. Deliberately simple and legible: move only when a different target
// beats the current one by more than the threshold, otherwise hold. The point of Avow is
// the provable record, not the alpha, so the policy stays easy to read and explain.

import type { Observation, Decision } from "./money";

export function decide(obs: Observation, thresholdBps: number): Decision {
  const current = obs.current;
  const currentRate = obs.rates.find((r) => r.target === current.target)?.apyBps ?? 0;
  const best = obs.rates.reduce((a, b) => (b.apyBps > a.apyBps ? b : a));
  const improvement = best.apyBps - currentRate;

  if (best.target === current.target || improvement < thresholdBps) {
    return {
      move: false,
      actionType: "yield_move",
      fromTarget: current.target,
      toTarget: current.target,
      amount: "0",
      rationale:
        `Held. Best is ${best.target} at ${best.apyBps}bps, which does not beat ` +
        `${current.target} at ${currentRate}bps by the ${thresholdBps}bps threshold.`,
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
      `Moved from ${current.target} at ${currentRate}bps to ${best.target} at ` +
      `${best.apyBps}bps, a ${improvement}bps gain over the ${thresholdBps}bps threshold.`,
    observed: obs.rates,
  };
}
