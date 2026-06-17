// Create a mandate and its evidence access from the browser, signed by the connected wallet.
//
// Two transactions: create the mandate, then create the access gated by the cap it returned.
// dapp-kit returns a digest, so we read the created object ids back from the fullnode, with a
// short retry since the node can lag a moment behind execution.

import { Transaction } from "@mysten/sui/transactions";
import { suiClient } from "./records";
import { PACKAGE_ID } from "./config";

type SignAndExecute = (input: { transaction: Transaction }) => Promise<{ digest: string }>;

export interface SetupParams {
  agent: string;
  perMoveCap: bigint;
  dailyCap: bigint;
  expiryEpoch: bigint;
}

export interface SetupResult {
  mandateId: string;
  accessId: string;
  capId: string;
}

function findCreated(changes: unknown[], suffix: string): string {
  for (const c of (changes ?? []) as Array<Record<string, unknown>>) {
    if (c.type === "created" && String(c.objectType).endsWith(suffix)) {
      return String(c.objectId);
    }
  }
  throw new Error(`no created object of type ...${suffix}`);
}

async function objectChanges(digest: string): Promise<unknown[]> {
  const client = suiClient();
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const tb = await client.getTransactionBlock({ digest, options: { showObjectChanges: true } });
      if (tb.objectChanges) return tb.objectChanges;
    } catch {
      // fullnode may not have indexed the transaction yet; retry
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("could not read the transaction's object changes");
}

export async function setupMandate(
  signAndExecute: SignAndExecute,
  params: SetupParams,
): Promise<SetupResult> {
  const txMandate = new Transaction();
  txMandate.moveCall({
    target: `${PACKAGE_ID}::mandate::create_entry`,
    arguments: [
      txMandate.pure.address(params.agent),
      txMandate.pure.u64(params.perMoveCap),
      txMandate.pure.u64(params.dailyCap),
      txMandate.pure.u64(params.expiryEpoch),
      txMandate.pure.bool(false),
    ],
  });
  const rMandate = await signAndExecute({ transaction: txMandate });
  const ch1 = await objectChanges(rMandate.digest);
  const mandateId = findCreated(ch1, "::mandate::Mandate");
  const capId = findCreated(ch1, "::mandate::MandateCap");

  const txAccess = new Transaction();
  txAccess.moveCall({
    target: `${PACKAGE_ID}::record::create_access`,
    arguments: [txAccess.object(mandateId), txAccess.object(capId)],
  });
  const rAccess = await signAndExecute({ transaction: txAccess });
  const ch2 = await objectChanges(rAccess.digest);
  const accessId = findCreated(ch2, "::record::EvidenceAccess");

  return { mandateId, accessId, capId };
}
