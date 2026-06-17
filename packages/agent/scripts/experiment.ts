// A live experiment with Avow.
//
// The reference yield agent runs several cycles against a changing rate feed. Each cycle it
// observes the rates, decides by its rules (move only when a better target beats the current
// one by more than the threshold), and when it moves it anchors the evidence as a real,
// verifiable proof on testnet. The result is a genuine track record you can open and verify.
//
// Run from the repo root: npx tsx packages/agent/scripts/experiment.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getSuiClient, getSealClient, getWalrusClient, createMandate, NETWORK } from "avow-sdk";
import type { RateQuote } from "../src/money";
import { ScenarioMoneyLayer } from "../src/scenario-money";
import { runCycle } from "../src/agent";

const THRESHOLD_BPS = 50;

// Six cycles of yields. The agent should move at 1, 2 and 5, and hold at 3 (no target yet),
// 4 (the gain is under the threshold) and 6 (already in the best target).
const SCHEDULE: RateQuote[][] = [
  [{ target: "navi", apyBps: 530 }, { target: "scallop", apyBps: 415 }, { target: "idle", apyBps: 0 }],
  [{ target: "navi", apyBps: 470 }, { target: "scallop", apyBps: 545 }, { target: "idle", apyBps: 0 }],
  [{ target: "navi", apyBps: 505 }, { target: "scallop", apyBps: 530 }, { target: "idle", apyBps: 0 }],
  [{ target: "navi", apyBps: 560 }, { target: "scallop", apyBps: 520 }, { target: "idle", apyBps: 0 }],
  [{ target: "navi", apyBps: 640 }, { target: "scallop", apyBps: 500 }, { target: "idle", apyBps: 0 }],
  [{ target: "navi", apyBps: 600 }, { target: "scallop", apyBps: 590 }, { target: "idle", apyBps: 0 }],
];

function loadKeypair(): Ed25519Keypair {
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
  const keypair = loadKeypair();
  const address = keypair.getPublicKey().toSuiAddress();

  const suiClient = getSuiClient();
  const sealClient = getSealClient(suiClient);
  const walrusClient = getWalrusClient(suiClient);

  // A fresh mandate for this experiment, naming this wallet as the agent.
  let mandateId = process.env.AVOW_MANDATE_ID;
  let accessId = process.env.AVOW_ACCESS_ID;
  if (!mandateId || !accessId) {
    console.log("creating a mandate for this experiment...");
    const created = await createMandate(suiClient, keypair, {
      agent: address,
      perMoveCap: 1_000_000n,
      dailyCap: 10_000_000n,
      expiryEpoch: 100_000n,
    });
    mandateId = created.mandateId;
    accessId = created.accessId;
  }

  const money = new ScenarioMoneyLayer(
    suiClient,
    keypair,
    address,
    { target: "idle", amount: "500000" },
    SCHEDULE,
  );

  console.log(`\nnetwork:  ${NETWORK}`);
  console.log(`agent:    ${address}`);
  console.log(`mandate:  ${mandateId}`);
  console.log(`access:   ${accessId}`);
  console.log(`rule:     move only when a target beats the current one by ${THRESHOLD_BPS}bps\n`);

  let moves = 0;
  let holds = 0;
  for (let i = 0; i < SCHEDULE.length; i++) {
    const result = await runCycle({
      suiClient,
      sealClient,
      walrusClient,
      signer: keypair,
      agentAddress: address,
      mandateId,
      accessId,
      money,
      thresholdBps: THRESHOLD_BPS,
    });

    const n = String(i + 1).padStart(2, "0");
    if (result.moved) {
      moves += 1;
      const a = result.anchored!;
      console.log(`cycle ${n}  MOVED   ${result.decision.fromTarget} -> ${result.decision.toTarget}`);
      console.log(`          ${result.decision.rationale}`);
      console.log(`          proof: https://suiscan.xyz/${NETWORK}/tx/${a.anchorDigest}\n`);
    } else {
      holds += 1;
      console.log(`cycle ${n}  HELD`);
      console.log(`          ${result.decision.rationale}\n`);
    }
    money.advance();
  }

  console.log("-----------------------------------------------------------");
  console.log(`done. ${moves} moves anchored, ${holds} holds, over ${SCHEDULE.length} cycles.`);
  console.log(`\nthis is a real track record. verify every move yourself:`);
  console.log(`  avow verify --mandate ${mandateId}`);
  console.log(`or open the dashboard and paste the mandate id:`);
  console.log(`  ${mandateId}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
