// Step 2 of the Avow quickstart: prove an agent action.
//
// This stands in for your agent. It does one tiny on-chain action, then anchors the evidence
// through Avow. The only Avow-specific part is the single anchor() call near the bottom; the
// rest is just your agent doing its work. Run from this folder:
//
//   npx tsx agent.ts
//
// Reads AVOW_KEY, AVOW_MANDATE_ID, and AVOW_ACCESS_ID from .env or the environment.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  getSuiClient,
  getSealClient,
  getWalrusClient,
  anchor,
  EVIDENCE_VERSION,
  NETWORK,
} from "avow-sdk";

loadEnv();

function loadEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file; rely on the environment.
  }
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}. See .env.example and run create-mandate first.`);
  return v;
}

async function main() {
  const keypair = Ed25519Keypair.fromSecretKey(need("AVOW_KEY"));
  const address = keypair.getPublicKey().toSuiAddress();
  const mandateId = need("AVOW_MANDATE_ID");
  const accessId = need("AVOW_ACCESS_ID");

  const sui = getSuiClient();
  const seal = getSealClient(sui);
  const walrus = getWalrusClient(sui);

  // --- Your agent does its real work here. ---
  // We make a tiny on-chain marker so the evidence references a genuine transaction. Replace
  // this with your actual move (a payment, a swap, a trade) and capture its digests.
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [1]);
  tx.transferObjects([coin], address);
  const action = await sui.signAndExecuteTransaction({ transaction: tx, signer: keypair });

  // --- Prove it. This is the whole integration. ---
  const proof = await anchor({
    suiClient: sui,
    sealClient: seal,
    walrusClient: walrus,
    signer: keypair,
    mandateId,
    accessId,
    bundle: {
      version: EVIDENCE_VERSION,
      mandateId,
      agent: address,
      actionType: "demo_action",
      target: "example",
      amount: "1000",
      rationale: "Example action proving the Avow integration end to end.",
      observed: { note: "anything your agent relied on goes here, and stays private" },
      before: {},
      after: {},
      txDigests: [action.digest],
      timestampMs: Date.now(),
    },
  });

  console.log("anchored.");
  console.log(`  blob:      ${proof.blobId}`);
  console.log(`  hash:      ${proof.evidenceHashHex}`);
  console.log(`  proof:     https://suiscan.xyz/${NETWORK}/tx/${proof.anchorDigest}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
