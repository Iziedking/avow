// End-to-end proof on testnet, with the dev key acting as principal and agent.
//
// 1. Create a mandate (create_entry) and its evidence access (create_access), or reuse ones
//    passed via AVOW_MANDATE_ID and AVOW_ACCESS_ID.
// 2. Anchor one real action: build a bundle, Seal-encrypt it, store it on Walrus, and call
//    record::anchor.
// 3. Verify it back: read from Walrus, decrypt through Seal, recompute the hash, compare it
//    to the on-chain anchor, and confirm the action sits inside the mandate.
//
// Run: npx tsx packages/sdk/scripts/e2e.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SessionKey } from "@mysten/seal";
import type { SealClient } from "@mysten/seal";
import type { WalrusClient } from "@mysten/walrus";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { getSuiClient, getSealClient, getWalrusClient } from "../src/clients";
import { anchor } from "../src/anchor";
import { verify } from "../src/verify";
import { PACKAGE_ID, NETWORK } from "../src/config";
import { EVIDENCE_VERSION, type EvidenceBundle, type AnchoredRecord } from "../src/types";

function loadDevKeypair(): Ed25519Keypair {
  // A fresh user sets AVOW_KEY to their own Sui private key. The .firecrawl fallback is only
  // for this repo's local development.
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  try {
    const file = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
    return Ed25519Keypair.fromSecretKey(file.exportedPrivateKey as string);
  } catch {
    throw new Error("Set AVOW_KEY to your Sui private key (suiprivkey1...).");
  }
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
  const keypair = loadDevKeypair();
  const address = keypair.getPublicKey().toSuiAddress();
  console.log(`network: ${NETWORK}`);
  console.log(`dev address (principal and agent): ${address}`);

  const sui = getSuiClient();
  const seal = getSealClient(sui);
  const walrus = getWalrusClient(sui);

  const reuseMandate = process.env.AVOW_MANDATE_ID;
  const reuseAccess = process.env.AVOW_ACCESS_ID;

  let mandateId: string;
  let accessId: string;

  if (reuseMandate && reuseAccess) {
    mandateId = reuseMandate;
    accessId = reuseAccess;
    console.log(`reusing mandate: ${mandateId}`);
    console.log(`reusing access:  ${accessId}`);
  } else {
    // Create the mandate. Agent is the same dev address. Caps in the asset's smallest unit.
    const txCreate = new Transaction();
    txCreate.moveCall({
      target: `${PACKAGE_ID}::mandate::create_entry`,
      arguments: [
        txCreate.pure.address(address),
        txCreate.pure.u64(1_000_000n), // per_move_cap
        txCreate.pure.u64(10_000_000n), // daily_cap
        txCreate.pure.u64(100_000n), // expiry_epoch, far past the current testnet epoch
        txCreate.pure.bool(false), // restrict_targets
      ],
    });
    const rCreate = await sui.signAndExecuteTransaction({
      transaction: txCreate,
      signer: keypair,
      options: { showObjectChanges: true },
    });
    mandateId = createdId(rCreate.objectChanges ?? [], "::mandate::Mandate");
    const capId = createdId(rCreate.objectChanges ?? [], "::mandate::MandateCap");
    console.log(`mandate: ${mandateId}`);
    console.log(`cap:     ${capId}`);

    // Create the evidence access, gated by the cap.
    const txAccess = new Transaction();
    txAccess.moveCall({
      target: `${PACKAGE_ID}::record::create_access`,
      arguments: [txAccess.object(mandateId), txAccess.object(capId)],
    });
    const rAccess = await sui.signAndExecuteTransaction({
      transaction: txAccess,
      signer: keypair,
      options: { showObjectChanges: true },
    });
    accessId = createdId(rAccess.objectChanges ?? [], "::record::EvidenceAccess");
    console.log(`access:  ${accessId}`);
  }

  await runAnchorVerify(sui, seal, walrus, keypair, address, mandateId, accessId);
}

async function runAnchorVerify(
  sui: SuiJsonRpcClient,
  seal: SealClient,
  walrus: WalrusClient,
  keypair: Ed25519Keypair,
  address: string,
  mandateId: string,
  accessId: string,
) {
  // Build a bundle and anchor it.
  const bundle: EvidenceBundle = {
    version: EVIDENCE_VERSION,
    mandateId,
    agent: address,
    actionType: "yield_move",
    target: "navi",
    amount: "500000",
    rationale: "Moved idle USDC into the higher NAVI supply rate.",
    observed: { naviApyBps: 530, previousApyBps: 410, source: "navi.rates" },
    before: { pool: "idle", amount: "500000" },
    after: { pool: "navi", amount: "500000" },
    txDigests: [],
    timestampMs: Date.now(),
  };

  console.log("anchoring (seal encrypt, walrus store, record::anchor)...");
  const anchored = await anchor({
    suiClient: sui,
    sealClient: seal,
    walrusClient: walrus,
    signer: keypair,
    mandateId,
    accessId,
    bundle,
  });
  console.log(`  blob:      ${anchored.blobId}`);
  console.log(`  hash:      ${anchored.evidenceHashHex}`);
  console.log(`  anchor tx: ${anchored.anchorDigest}`);

  const events = await sui.queryEvents({ query: { Transaction: anchored.anchorDigest } });
  const anchoredEvent = events.data.find((e) => e.type.endsWith("::record::ActionAnchored"));
  console.log(`  on-chain event present: ${Boolean(anchoredEvent)}`);

  // Verify the record independently as a reader.
  const record: AnchoredRecord = {
    mandateId,
    accessId,
    agent: address,
    blobId: anchored.blobId,
    evidenceHashHex: anchored.evidenceHashHex,
    amount: bundle.amount,
    actionType: bundle.actionType,
    target: bundle.target,
    epoch: "0",
  };

  console.log("verifying (walrus read, seal decrypt, recompute hash, check mandate)...");
  const sessionKey = await SessionKey.create({
    address,
    packageId: PACKAGE_ID,
    ttlMin: 10,
    suiClient: sui,
  });
  const { signature } = await keypair.signPersonalMessage(sessionKey.getPersonalMessage());
  await sessionKey.setPersonalMessageSignature(signature);

  const result = await verify({
    suiClient: sui,
    sealClient: seal,
    walrusClient: walrus,
    sessionKey,
    record,
  });

  console.log("");
  console.log(`hash matches on-chain anchor: ${result.hashMatches}`);
  console.log(`amount matches:               ${result.amountMatches}`);
  console.log(`within mandate:               ${result.withinMandate}`);
  console.log(`decrypted rationale:          "${result.bundle.rationale}"`);

  if (result.hashMatches && result.amountMatches && result.withinMandate) {
    console.log("\nPROVEN: the record is real, unaltered, and within authority.");
  } else {
    console.log("\nFAILED: verification did not pass.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
