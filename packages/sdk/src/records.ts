// Read an agent's track record from chain.
//
// Every anchored action is an ActionAnchored event. Reading them back for a mandate
// reconstructs the full record, ready to hand to verify().

import { fromBase64, toHex } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { ORIGINAL_PACKAGE_ID } from "./config";
import type { AnchoredRecord } from "./types";

// A Move vector<u8> comes back from the RPC as a byte array or a base64 string. Handle both.
function toBytes(value: unknown): Uint8Array {
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (typeof value === "string") return fromBase64(value);
  return new Uint8Array();
}

function toText(value: unknown): string {
  return new TextDecoder().decode(toBytes(value));
}

export async function listRecords(
  suiClient: SuiJsonRpcClient,
  mandateId: string,
  limit = 50,
): Promise<AnchoredRecord[]> {
  const res = await suiClient.queryEvents({
    query: { MoveEventType: `${ORIGINAL_PACKAGE_ID}::record::ActionAnchored` },
    order: "descending",
    limit,
  });

  return res.data
    .map((e): AnchoredRecord => {
      const j = e.parsedJson as Record<string, unknown>;
      return {
        mandateId: String(j.mandate_id),
        accessId: String(j.access_id),
        agent: String(j.agent),
        user: String(j.user),
        blobId: toText(j.blob_id),
        evidenceHashHex: toHex(toBytes(j.evidence_hash)),
        amount: String(j.amount),
        actionType: toText(j.action_type),
        target: toText(j.target),
        epoch: String(j.epoch),
        txDigest: e.id.txDigest,
        timestampMs: Number(e.timestampMs ?? 0),
      };
    })
    .filter((r) => r.mandateId === mandateId);
}
