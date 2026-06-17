// Step 1 of the Avow quickstart: give an agent a mandate.
//
// The owner runs this once. It creates the mandate that names the agent and its limits, then
// creates the evidence access that holds the Seal policy, and prints the two ids the agent
// needs. Run from this folder:
//
//   npx tsx create-mandate.ts
//
// Reads AVOW_KEY (your Sui private key) and optional caps from .env or the environment.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, PACKAGE_ID, NETWORK } from "@avow/sdk";

loadEnv();

function loadEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file; rely on the environment.
  }
}

function ownerKeypair(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (!key) {
    throw new Error("Set AVOW_KEY to your Sui private key (suiprivkey1...). See .env.example.");
  }
  return Ed25519Keypair.fromSecretKey(key);
}

function createdId(changes: unknown[], suffix: string): string {
  for (const c of changes as Array<Record<string, unknown>>) {
    if (c.type === "created" && String(c.objectType).endsWith(suffix)) {
      return String(c.objectId);
    }
  }
  throw new Error(`no created object of type ...${suffix}`);
}

async function main() {
  const owner = ownerKeypair();
  const ownerAddress = owner.getPublicKey().toSuiAddress();
  const agent = process.env.AVOW_AGENT_ADDRESS ?? ownerAddress;

  const perMoveCap = BigInt(process.env.AVOW_PER_MOVE_CAP ?? "1000000000");
  const dailyCap = BigInt(process.env.AVOW_DAILY_CAP ?? "10000000000");
  const expiryEpoch = BigInt(process.env.AVOW_EXPIRY_EPOCH ?? "100000");

  const sui = getSuiClient();

  console.log(`network:   ${NETWORK}`);
  console.log(`owner:     ${ownerAddress}`);
  console.log(`agent:     ${agent}`);
  console.log("creating mandate and evidence access...\n");

  const txMandate = new Transaction();
  txMandate.moveCall({
    target: `${PACKAGE_ID}::mandate::create_entry`,
    arguments: [
      txMandate.pure.address(agent),
      txMandate.pure.u64(perMoveCap),
      txMandate.pure.u64(dailyCap),
      txMandate.pure.u64(expiryEpoch),
      txMandate.pure.bool(false), // restrict_targets: allow any target to start
    ],
  });
  const rMandate = await sui.signAndExecuteTransaction({
    transaction: txMandate,
    signer: owner,
    options: { showObjectChanges: true },
  });
  const mandateId = createdId(rMandate.objectChanges ?? [], "::mandate::Mandate");
  const capId = createdId(rMandate.objectChanges ?? [], "::mandate::MandateCap");

  const txAccess = new Transaction();
  txAccess.moveCall({
    target: `${PACKAGE_ID}::record::create_access`,
    arguments: [txAccess.object(mandateId), txAccess.object(capId)],
  });
  const rAccess = await sui.signAndExecuteTransaction({
    transaction: txAccess,
    signer: owner,
    options: { showObjectChanges: true },
  });
  const accessId = createdId(rAccess.objectChanges ?? [], "::record::EvidenceAccess");

  console.log("Done. Paste these into your .env, then run the agent:");
  console.log(`AVOW_MANDATE_ID=${mandateId}`);
  console.log(`AVOW_ACCESS_ID=${accessId}`);
  console.log(`\n(admin cap, keep it safe: ${capId})`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
