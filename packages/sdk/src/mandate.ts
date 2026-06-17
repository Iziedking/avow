// Create a mandate and its evidence access in one step.
//
// An owner runs this once to set what an agent may do and to stand up the Seal namespace its
// evidence lives in. Returns the two ids the agent anchors against, plus the admin cap id.

import { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";
import { PACKAGE_ID } from "./config";

export interface CreateMandateParams {
  /** The single agent address the mandate authorizes. */
  agent: string;
  /** Maximum amount per action, in the asset's smallest unit. */
  perMoveCap: bigint;
  /** Maximum cumulative amount per epoch. */
  dailyCap: bigint;
  /** The mandate is invalid from this epoch onward. */
  expiryEpoch: bigint;
  /** If true, the agent may only act on targets the owner allowlists. */
  restrictTargets?: boolean;
}

export interface CreatedMandate {
  mandateId: string;
  accessId: string;
  capId: string;
}

function createdId(changes: unknown[], suffix: string): string {
  for (const c of changes as Array<Record<string, unknown>>) {
    if (c.type === "created" && String(c.objectType).endsWith(suffix)) {
      return String(c.objectId);
    }
  }
  throw new Error(`no created object of type ...${suffix}`);
}

export async function createMandate(
  suiClient: SuiJsonRpcClient,
  signer: Signer,
  params: CreateMandateParams,
): Promise<CreatedMandate> {
  const txMandate = new Transaction();
  txMandate.moveCall({
    target: `${PACKAGE_ID}::mandate::create_entry`,
    arguments: [
      txMandate.pure.address(params.agent),
      txMandate.pure.u64(params.perMoveCap),
      txMandate.pure.u64(params.dailyCap),
      txMandate.pure.u64(params.expiryEpoch),
      txMandate.pure.bool(params.restrictTargets ?? false),
    ],
  });
  const rMandate = await suiClient.signAndExecuteTransaction({
    transaction: txMandate,
    signer,
    options: { showObjectChanges: true },
  });
  const mandateId = createdId(rMandate.objectChanges ?? [], "::mandate::Mandate");
  const capId = createdId(rMandate.objectChanges ?? [], "::mandate::MandateCap");

  const txAccess = new Transaction();
  txAccess.moveCall({
    target: `${PACKAGE_ID}::record::create_access`,
    arguments: [txAccess.object(mandateId), txAccess.object(capId)],
  });
  const rAccess = await suiClient.signAndExecuteTransaction({
    transaction: txAccess,
    signer,
    options: { showObjectChanges: true },
  });
  const accessId = createdId(rAccess.objectChanges ?? [], "::record::EvidenceAccess");

  return { mandateId, accessId, capId };
}
