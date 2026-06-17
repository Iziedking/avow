// The shapes the Avow SDK works with.
//
// An EvidenceBundle is the full, private account of one agent action. It is hashed and
// sealed, stored on Walrus, and its hash plus a few public fields are anchored on chain.
// Strategy detail lives here, off chain, never in the Move event.

export const EVIDENCE_VERSION = 1;

export interface EvidenceBundle {
  /** Bundle schema version. */
  version: number;
  /** The mandate this action was taken under. */
  mandateId: string;
  /** The agent address that took the action. */
  agent: string;
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
}

export interface VerifyResult {
  /** The recomputed hash matches the on-chain anchor: the evidence was not altered. */
  hashMatches: boolean;
  /** The bundle's amount matches the anchored amount. */
  amountMatches: boolean;
  /** The action sits inside the mandate's limits as read independently from chain. */
  withinMandate: boolean;
  /** The decrypted bundle. */
  bundle: EvidenceBundle;
}
