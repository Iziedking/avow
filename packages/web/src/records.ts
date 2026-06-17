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

export async function fetchRecords(mandateId: string): Promise<AnchoredRecord[]> {
  const client = suiClient();
  const res = await client.queryEvents({
    query: { MoveEventType: `${PACKAGE_ID}::record::ActionAnchored` },
    order: "descending",
    limit: 50,
  });

  const records = res.data.map((e): AnchoredRecord => {
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
  });

  return records.filter((r) => r.mandateId === mandateId);
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
