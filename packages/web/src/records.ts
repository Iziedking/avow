// Read an agent's track record straight from chain.
//
// Every move the agent anchored is an ActionAnchored event. Reading them back reconstructs
// the full record. This view is public and needs no wallet: the existence of each anchor is
// already proof the move passed its mandate. Decrypting the evidence and recomputing the hash
// is the next step, and that one needs a reader's key.

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { fromBase64, toHex } from "@mysten/sui/utils";
import { NETWORK, PACKAGE_ID } from "./config";

export interface AnchoredRecord {
  mandateId: string;
  accessId: string;
  agent: string;
  blobId: string;
  evidenceHashHex: string;
  amount: string;
  actionType: string;
  target: string;
  epoch: string;
  txDigest: string;
  timestampMs: number;
}

export function suiClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });
}

// A Move vector<u8> comes back from the RPC as either an array of byte values or a base64
// string, depending on the field. Handle both.
function toBytes(value: unknown): Uint8Array {
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (typeof value === "string") return fromBase64(value);
  return new Uint8Array();
}

function toText(value: unknown): string {
  return new TextDecoder().decode(toBytes(value));
}

function parseAnchored(e: { parsedJson: unknown; id: { txDigest: string }; timestampMs?: string | null }): AnchoredRecord {
  const j = e.parsedJson as Record<string, unknown>;
  return {
    mandateId: String(j.mandate_id),
    accessId: String(j.access_id),
    agent: String(j.agent),
    blobId: toText(j.blob_id),
    evidenceHashHex: toHex(toBytes(j.evidence_hash)),
    amount: String(j.amount),
    actionType: toText(j.action_type),
    target: toText(j.target),
    epoch: String(j.epoch),
    txDigest: e.id.txDigest,
    timestampMs: Number(e.timestampMs ?? 0),
  };
}

// A mandate's records, and only that mandate's. Anchors from other mandates are filtered out,
// so nobody's track record leaks into yours. The event feed is paged so a mandate's records
// still surface once many agents are anchoring, not just within the latest global window.
export async function fetchRecords(mandateId: string): Promise<AnchoredRecord[]> {
  const client = suiClient();
  const mine: AnchoredRecord[] = [];
  let cursor: { txDigest: string; eventSeq: string } | null | undefined = null;

  for (let page = 0; page < 8; page++) {
    const res = await client.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::record::ActionAnchored` },
      order: "descending",
      limit: 50,
      cursor,
    });
    for (const e of res.data) {
      const r = parseAnchored(e);
      if (r.mandateId === mandateId) mine.push(r);
    }
    if (!res.hasNextPage || !res.nextCursor || mine.length >= 200) break;
    cursor = res.nextCursor;
  }

  return mine;
}

export interface MandateInfo {
  agent: string;
  perMoveCap: string;
  dailyCap: string;
}

// The mandate's rules: who its agent is, and the limits every action is checked against.
export async function fetchMandate(mandateId: string): Promise<MandateInfo | null> {
  const client = suiClient();
  try {
    const res = await client.getObject({ id: mandateId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    const f = (content as { fields: Record<string, unknown> }).fields;
    return {
      agent: String(f.agent),
      perMoveCap: String(f.per_move_cap),
      dailyCap: String(f.daily_cap),
    };
  } catch {
    return null;
  }
}

// The single evidence access registered for a mandate, found from its AccessCreated event.
export async function fetchAccessId(mandateId: string): Promise<string | null> {
  const client = suiClient();
  const res = await client.queryEvents({
    query: { MoveEventType: `${PACKAGE_ID}::record::AccessCreated` },
    order: "descending",
    limit: 50,
  });
  const ev = res.data.find(
    (e) => String((e.parsedJson as Record<string, unknown>).mandate_id) === mandateId,
  );
  return ev ? String((ev.parsedJson as Record<string, unknown>).access_id) : null;
}
