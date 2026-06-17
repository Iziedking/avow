// The agent loop: observe, decide, execute, prove.
//
// The first three steps are ordinary agent work. The fourth, anchoring the evidence through
// the Avow SDK, is what makes the move provable. Nothing here knows how the money moves; it
// only knows the money layer and the proof layer.

import { anchor, EVIDENCE_VERSION } from "@avow/sdk";
import type { AnchorResult, EvidenceBundle } from "@avow/sdk";
import type { getSuiClient, getSealClient, getWalrusClient } from "@avow/sdk";
import type { Signer } from "@mysten/sui/cryptography";
import { decide } from "./policy";
import type { Decision, MoneyLayer } from "./money";

export interface AgentConfig {
  suiClient: ReturnType<typeof getSuiClient>;
  sealClient: ReturnType<typeof getSealClient>;
  walrusClient: ReturnType<typeof getWalrusClient>;
  signer: Signer;
  agentAddress: string;
  mandateId: string;
  accessId: string;
  money: MoneyLayer;
  thresholdBps: number;
}

export interface CycleResult {
  moved: boolean;
  decision: Decision;
  anchored?: AnchorResult;
}

export async function runCycle(cfg: AgentConfig): Promise<CycleResult> {
  const observation = await cfg.money.observe();
  const decision = decide(observation, cfg.thresholdBps);

  if (!decision.move) {
    return { moved: false, decision };
  }

  const execution = await cfg.money.execute(decision);

  const bundle: EvidenceBundle = {
    version: EVIDENCE_VERSION,
    mandateId: cfg.mandateId,
    agent: cfg.agentAddress,
    actionType: decision.actionType,
    target: decision.toTarget,
    amount: decision.amount,
    rationale: decision.rationale,
    observed: decision.observed,
    before: execution.before,
    after: execution.after,
    txDigests: execution.txDigests,
    timestampMs: Date.now(),
  };

  const anchored = await anchor({
    suiClient: cfg.suiClient,
    sealClient: cfg.sealClient,
    walrusClient: cfg.walrusClient,
    signer: cfg.signer,
    mandateId: cfg.mandateId,
    accessId: cfg.accessId,
    bundle,
  });

  return { moved: true, decision, anchored };
}
