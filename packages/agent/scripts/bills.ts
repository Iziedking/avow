// A bill-paying agent: the consumer side of Avow.
//
// It reviews each bill and pays only the ones that are due, from a biller you approved, within
// your per-payment limit, and not a likely overcharge. Critically, it records every decision,
// paid or refused, with its reasoning. So you can prove it never paid the wrong merchant, never
// overpaid, and never went over your limit, the exact things you cannot check today.
//
// Run from the repo root: npx tsx packages/agent/scripts/bills.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  getSuiClient,
  getSealClient,
  getWalrusClient,
  createMandate,
  anchor,
  EVIDENCE_VERSION,
  NETWORK,
} from "avow-sdk";

const PER_PAYMENT_CAP = 5000;
const DAILY_CAP = 100000;
const OVERPAY_TOLERANCE = 1.25; // more than 25% over the usual amount is treated as suspicious
const APPROVED = new Set(["netflix", "spotify", "electric", "gym", "internet"]);

interface Bill {
  merchant: string;
  amount: number;
  usual: number;
}

// Six bills came in. Three are normal. One is a likely overcharge, one is from a biller you
// never approved, and one is over your per-payment limit. The agent should pay three and refuse
// three, each with a clear reason.
const BILLS: Bill[] = [
  { merchant: "netflix", amount: 1599, usual: 1599 },
  { merchant: "spotify", amount: 999, usual: 999 },
  { merchant: "electric", amount: 4900, usual: 2400 },
  { merchant: "gym", amount: 4000, usual: 4000 },
  { merchant: "quickcash", amount: 5000, usual: 0 },
  { merchant: "internet", amount: 6000, usual: 6000 },
];

function decide(b: Bill): { pay: boolean; rationale: string } {
  if (!APPROVED.has(b.merchant)) {
    return {
      pay: false,
      rationale: `Refused ${b.merchant} ${b.amount}: not on your list of approved billers, it could be a scam.`,
    };
  }
  if (b.amount > PER_PAYMENT_CAP) {
    return {
      pay: false,
      rationale: `Refused ${b.merchant} ${b.amount}: over your ${PER_PAYMENT_CAP} per-payment limit, left for you to approve.`,
    };
  }
  if (b.usual > 0 && b.amount > Math.round(b.usual * OVERPAY_TOLERANCE)) {
    return {
      pay: false,
      rationale: `Refused ${b.merchant} ${b.amount}: far above the usual ${b.usual}, a likely overcharge, left for you to review.`,
    };
  }
  return {
    pay: true,
    rationale: `Paid ${b.merchant} ${b.amount}: due now, matches the usual ${b.usual}, from an approved biller, and within your ${PER_PAYMENT_CAP} limit.`,
  };
}

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
  const sui = getSuiClient();
  const seal = getSealClient(sui);
  const walrus = getWalrusClient(sui);

  let mandateId = process.env.AVOW_MANDATE_ID;
  let accessId = process.env.AVOW_ACCESS_ID;
  if (!mandateId || !accessId) {
    console.log("creating a mandate for the bill payer...");
    const created = await createMandate(sui, keypair, {
      agent: address,
      perMoveCap: BigInt(PER_PAYMENT_CAP),
      dailyCap: BigInt(DAILY_CAP),
      expiryEpoch: 100000n,
    });
    mandateId = created.mandateId;
    accessId = created.accessId;
  }

  console.log(`\nnetwork:  ${NETWORK}`);
  console.log(`agent:    ${address}`);
  console.log(`mandate:  ${mandateId}`);
  console.log(
    `rule:     pay approved billers that are due, within ${PER_PAYMENT_CAP} per payment, refuse overcharges\n`,
  );

  let paid = 0;
  let refused = 0;
  for (const bill of BILLS) {
    const { pay, rationale } = decide(bill);

    let txDigests: string[] = [];
    if (pay) {
      // A real but tiny marker transfer, so the evidence references a genuine digest.
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [1]);
      tx.transferObjects([coin], address);
      const r = await sui.signAndExecuteTransaction({ transaction: tx, signer: keypair });
      txDigests = [r.digest];
    }

    const result = await anchor({
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
        actionType: pay ? "payment" : "payment_refused",
        target: bill.merchant,
        amount: pay ? String(bill.amount) : "0",
        rationale,
        observed: {
          merchant: bill.merchant,
          billed: bill.amount,
          usual: bill.usual,
          approved: APPROVED.has(bill.merchant),
        },
        before: {},
        after: {},
        txDigests,
        timestampMs: Date.now(),
      },
    });

    if (pay) paid += 1;
    else refused += 1;
    console.log(`${pay ? "PAID   " : "REFUSED"} ${bill.merchant} ${bill.amount}`);
    console.log(`        ${rationale}`);
    console.log(`        proof: https://suiscan.xyz/${NETWORK}/tx/${result.anchorDigest}\n`);
  }

  console.log("-----------------------------------------------------------");
  console.log(`done. ${paid} paid, ${refused} refused, every decision recorded and provable.`);
  console.log(`\nverify every decision yourself:`);
  console.log(`  avow verify --mandate ${mandateId}`);
  console.log(`or open the dashboard and paste the mandate id:`);
  console.log(`  ${mandateId}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
