// Run one cycle of the reference agent on testnet: observe rates, decide, make a real marker
// move, and anchor the evidence through the Avow trust layer.
//
// Run from the repo root: npx tsx packages/agent/scripts/run.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getSuiClient, getSealClient, getWalrusClient, createMandate, NETWORK } from "avow-sdk";
import { LocalMoneyLayer } from "../src/local-money";
import { runCycle } from "../src/agent";

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

async function main() {
  const keypair = loadDevKeypair();
  const address = keypair.getPublicKey().toSuiAddress();

  const suiClient = getSuiClient();
  const sealClient = getSealClient(suiClient);
  const walrusClient = getWalrusClient(suiClient);

  // Use a mandate from the environment, or create one naming this wallet as the agent. The
  // contract only lets the named agent anchor, so the agent has to own its own mandate.
  let mandateId = process.env.AVOW_MANDATE_ID;
  let accessId = process.env.AVOW_ACCESS_ID;
  if (!mandateId || !accessId) {
    console.log("no mandate set, creating one for this agent...");
    const created = await createMandate(suiClient, keypair, {
      agent: address,
      perMoveCap: 1_000_000n,
      dailyCap: 10_000_000n,
      expiryEpoch: 100_000n,
    });
    mandateId = created.mandateId;
    accessId = created.accessId;
    console.log(`mandate: ${mandateId}`);
    console.log(`access:  ${accessId}`);
  }

  const money = new LocalMoneyLayer(suiClient, keypair, address, {
    target: "idle",
    amount: "500000",
  });

  console.log(`network: ${NETWORK}`);
  console.log(`agent:   ${address}`);
  console.log(`money:   ${money.name}`);
  console.log("running one cycle (observe, decide, execute, prove)...\n");

  const result = await runCycle({
    suiClient,
    sealClient,
    walrusClient,
    signer: keypair,
    agentAddress: address,
    mandateId,
    accessId,
    money,
    thresholdBps: 50,
    maxRiskBps: 150,
  });

  console.log(`decision: ${result.decision.rationale}`);
  if (!result.moved) {
    console.log("held this cycle, nothing to anchor.");
    return;
  }

  const a = result.anchored!;
  console.log(`moved.`);
  console.log(`  blob:      ${a.blobId}`);
  console.log(`  hash:      ${a.evidenceHashHex}`);
  console.log(`  anchor tx: ${a.anchorDigest}`);
  console.log(`\nproof: https://suiscan.xyz/testnet/tx/${a.anchorDigest}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
