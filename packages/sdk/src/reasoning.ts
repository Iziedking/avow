// A small builder agents use to capture their full reasoning as they work, then hand to
// anchor(). Each call records one step; build() seals it with the outcome. The whole trace is
// encrypted to the user the action served and hash-anchored on chain, so it is private yet
// tamper-proof: a consumer can later replay exactly how the agent reached its decision.
//
//   const r = new Reasoning("Pay this month's bills");
//   r.observe("Read the bill", `Netflix asks ${billed}`, { billed });
//   r.think("Compared to your usual", `usual is ${usual}, this matches`);
//   r.tool("Checked your approved billers", "Netflix is on the list");
//   r.decide("Within your 5000 per-payment limit", "approved");
//   const reasoning = r.build("Paid Netflix 1599");

import type { ReasoningStep, ReasoningTrace } from "./types";

export class Reasoning {
  private readonly steps: ReasoningStep[] = [];

  constructor(private readonly goal: string) {}

  /** Something the agent read or was given: a bill, a rate, a balance, a signal it paid for. */
  observe(title: string, detail?: string, data?: unknown): this {
    this.steps.push({ kind: "observe", title, detail, data });
    return this;
  }

  /** A consideration or comparison the agent made on the way to its decision. */
  think(title: string, detail?: string, data?: unknown): this {
    this.steps.push({ kind: "think", title, detail, data });
    return this;
  }

  /** A tool, model, or external call the agent ran, and what came back. */
  tool(title: string, detail?: string, data?: unknown): this {
    this.steps.push({ kind: "tool", title, detail, data });
    return this;
  }

  /** The decision the agent committed to, and why. */
  decide(title: string, detail?: string, data?: unknown): this {
    this.steps.push({ kind: "decide", title, detail, data });
    return this;
  }

  /** Number of steps captured so far. */
  get length(): number {
    return this.steps.length;
  }

  /** Seal the trace with the one-line outcome. */
  build(outcome: string): ReasoningTrace {
    return { goal: this.goal, steps: [...this.steps], outcome };
  }
}
