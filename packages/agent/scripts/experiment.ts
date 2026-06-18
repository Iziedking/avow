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
const MAX_RISK_BPS = 150;

// Six cycles of yields. degenpool always offers the highest APY but its risk (320bps) is over
// the limit, so the agent ignores it every cycle, the discipline the proof is meant to show.
// Among the safe pools it moves at 1, 3, 4 and 6, and holds at 2 (gain under the threshold) and
// 5 (already in the best). Each rate is [apyBps, riskBps].
function q(target: string, apyBps: number, riskBps: number): RateQuote {
  return { target, apyBps, riskBps };
}
const SCHEDULE: RateQuote[][] = [
  [q("navi", 530, 25), q("scallop", 415, 60), q("degenpool", 920, 320), q("idle", 0, 0)],
  [q("navi", 470, 25), q("scallop", 545, 60), q("degenpool", 880, 320), q("idle", 0, 0)],
  [q("navi", 460, 25), q("scallop", 560, 60), q("degenpool", 900, 320), q("idle", 0, 0)],
  [q("navi", 600, 25), q("scallop", 540, 60), q("degenpool", 950, 320), q("idle", 0, 0)],
  [q("navi", 590, 25), q("scallop", 585, 60), q("degenpool", 1000, 320), q("idle", 0, 0)],
  [q("navi", 480, 25), q("scallop", 600, 60), q("degenpool", 870, 320), q("idle", 0, 0)],
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
  console.log(
    `rule:     ignore pools over ${MAX_RISK_BPS}bps risk, then move only when a safe pool beats ` +
      `the current one by ${THRESHOLD_BPS}bps risk-adjusted\n`,
  );

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
      maxRiskBps: MAX_RISK_BPS,
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
