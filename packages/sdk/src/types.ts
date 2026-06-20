// The shapes the Avow SDK works with.
//
// An EvidenceBundle is the full, private account of one agent action. It is hashed and
// sealed, stored on Walrus, and its hash plus a few public fields are anchored on chain.
// Strategy detail lives here, off chain, never in the Move event.

export const EVIDENCE_VERSION = 2;

/** One step in an agent's reasoning toward an action. The `kind` drives how the dashboard
 *  renders it, so a consumer can replay exactly how the agent thought. */
export type ReasoningStepKind = "observe" | "think" | "tool" | "decide";

export interface ReasoningStep {
  kind: ReasoningStepKind;
  /** A short headline for the step, e.g. "Checked the biller against your approved list". */
  title: string;
  /** The detail: the agent's actual thought, the data it read, the tool result. */
  detail?: string;
  /** Optional structured data the step relied on (rates, amounts, args, results). */
  data?: unknown;
}

/** The agent's full reasoning toward one action: the goal it was given, the ordered steps it
 *  took, and the outcome it reached. Sealed to the user it served, so only they (and the owner)
 *  can replay it, yet its hash is anchored on chain so it cannot be altered after the fact. */
export interface ReasoningTrace {
  /** The task the user asked of the agent. */
  goal: string;
  /** The ordered steps the agent took to reach its decision. */
  steps: ReasoningStep[];
  /** The outcome in one line, e.g. "Paid Netflix 1599" or "Refused: over your limit". */
  outcome: string;
}

export interface EvidenceBundle {
  /** Bundle schema version. */
  version: number;
  /** The mandate this action was taken under. */
  mandateId: string;
  /** The agent address that took the action. */
  agent: string;
  /** The user this action was taken for. The evidence is sealed to this address, so on a shared
   *  agent each user decrypts only their own. For a single-user agent this is the owner. */
  user: string;
  /** The agent's full reasoning toward this action: goal, ordered steps, outcome. */
  reasoning?: ReasoningTrace;
  /** What kind of action, matching the on-chain action_type, for example "yield_move". */
  actionType: string;
  /** What the action acted on, matching the on-chain target, for example "navi". */
  target: string;
  /** Amount moved, as a u64 decimal string, matching the on-chain amount. */
  amount: string;
  /** Why the agent took this action, in plain words. */
  rationale: string;
  /** Anything the agent relied on: rates seen, signals bought, paid receipts. */
  observed?: unknown;
  /** Position before the action. */
  before?: unknown;
  /** Position after the action. */
  after?: unknown;
  /** Sui transaction digests of the actual money moves, so a verifier can reconcile. */
  txDigests: string[];
  /** When the bundle was built, in milliseconds since the epoch. */
  timestampMs: number;
}

export interface AnchorResult {
  /** Walrus blob id of the sealed bundle. */
  blobId: string;
  /** Hex SHA-256 of the plaintext bundle, as anchored on chain. */
  evidenceHashHex: string;
  /** Digest of the anchor transaction. */
  anchorDigest: string;
}

/** An anchored action read back from an ActionAnchored event. */
export interface AnchoredRecord {
  mandateId: string;
  accessId: string;
  agent: string;
  /** The user this action was taken for, from the event. The dashboard filters by this so each
   *  user sees only their own actions; the reasoning behind them stays sealed to that user. */
  user: string;
  /** Walrus blob id, decoded back to a string. */
  blobId: string;
  /** Hex SHA-256 of the plaintext bundle. */
  evidenceHashHex: string;
  amount: string;
  actionType: string;
  target: string;
  epoch: string;
  /** Digest of the transaction that emitted the anchor, when read from an event. */
  txDigest?: string;
  /** When the anchor was emitted, in milliseconds, when available. */
  timestampMs?: number;
  /** True if the action stayed inside every mandate limit at anchor time, stamped on chain. */
  withinMandate?: boolean;
  /** Bitmask of the limits the action broke (0 = none), as recorded on chain. */
  breaches?: number;
}

/** Mandate-breach bits, matching the Move contract (mandate.move). A forensic record carries this
 *  so an auditor can see exactly which rules an action broke. */
export const BREACH = {
  REVOKED: 1,
  EXPIRED: 2,
  PER_MOVE: 4,
  DAILY: 8,
  TARGET: 16,
} as const;

/** Decode a breach bitmask into plain-language labels. Empty when the action was within bounds. */
export function breachLabels(breaches: number): string[] {
  const out: string[] = [];
  if (breaches & BREACH.REVOKED) out.push("mandate revoked");
  if (breaches & BREACH.EXPIRED) out.push("mandate expired");
  if (breaches & BREACH.PER_MOVE) out.push("over the per-move cap");
  if (breaches & BREACH.DAILY) out.push("over the daily cap");
  if (breaches & BREACH.TARGET) out.push("target not allowed");
  return out;
}

export interface VerifyResult {
  /** The recomputed hash matches the on-chain anchor: the evidence was not altered. */
  hashMatches: boolean;
  /** The bundle's amount matches the anchored amount. */
  amountMatches: boolean;
  /** The action stayed inside the mandate's limits, from the on-chain verdict stamped at anchor
   *  time (falls back to a fresh read for records anchored before the forensic upgrade). */
  withinMandate: boolean;
  /** Bitmask of the limits the action broke (0 = none), from the on-chain record. */
  breaches: number;
  /** The decrypted bundle. */
  bundle: EvidenceBundle;
}
