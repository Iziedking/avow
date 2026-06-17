// Run one cycle of the reference agent on testnet: observe rates, decide, make a real marker
// move, and anchor the evidence through the Avow trust layer.
//
// Run from the repo root: npx tsx packages/agent/scripts/run.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getSuiClient, getSealClient, getWalrusClient, NETWORK } from "avow-sdk";
import { LocalMoneyLayer } from "../src/local-money";
import { runCycle } from "../src/agent";

const MANDATE_ID =
  process.env.AVOW_MANDATE_ID ??
  "0x0f893eb746e08ae348d1389f3c633b282966218e784e8f142bf0acaa60184c11";
const ACCESS_ID =
  process.env.AVOW_ACCESS_ID ??
  "0x8f11810dabe1717db797bbb15afbcb21072fe56d3b8198213e4608a67d719ec1";

function loadDevKeypair(): Ed25519Keypair {
  const file = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(file.exportedPrivateKey as string);
}

async function main() {
  const keypair = loadDevKeypair();
  const address = keypair.getPublicKey().toSuiAddress();

  const suiClient = getSuiClient();
  const sealClient = getSealClient(suiClient);
  const walrusClient = getWalrusClient(suiClient);

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
    mandateId: MANDATE_ID,
    accessId: ACCESS_ID,
    money,
    thresholdBps: 50,
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
