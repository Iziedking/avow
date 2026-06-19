// A shared bill-paying agent: the consumer side of Avow, now multi-tenant.
//
// ONE agent serves TWO consumers, Alice and Bob. For each user it reviews their bills and pays
// only the ones that are due, from a biller they approved, within their per-payment limit, and
// not a likely overcharge. It records every decision, paid or refused, with its FULL REASONING,
// and seals each record to the user it served. So on the dashboard each consumer can replay
// exactly how the agent reasoned for them, and cryptographically cannot see the other's.
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
  Reasoning,
  EVIDENCE_VERSION,
  NETWORK,
  type ReasoningTrace,
} from "avow-sdk";

const PER_PAYMENT_CAP = 5000;
const DAILY_CAP = 100000;
const OVERPAY_TOLERANCE = 1.25; // more than 25% over the usual is treated as suspicious
const APPROVED = new Set(["netflix", "spotify", "electric", "gym", "internet"]);

interface Bill {
  merchant: string;
  amount: number;
  usual: number;
}

// Each consumer's bills. A mix of normal, overcharge, unknown biller, and over-limit, so the
// agent pays some and refuses others, with a clear, provable reason for each.
const ALICE_BILLS: Bill[] = [
  { merchant: "netflix", amount: 1599, usual: 1599 },
  { merchant: "electric", amount: 4900, usual: 2400 },
  { merchant: "quickcash", amount: 5000, usual: 0 },
];
const BOB_BILLS: Bill[] = [
  { merchant: "spotify", amount: 999, usual: 999 },
  { merchant: "gym", amount: 4000, usual: 4000 },
  { merchant: "internet", amount: 6000, usual: 6000 },
];

interface Decision {
  pay: boolean;
  rationale: string;
  reasoning: ReasoningTrace;
}

// Decide, capturing the full reasoning as we go so a consumer can replay it later.
function decide(user: string, b: Bill): Decision {
  const r = new Reasoning(`Pay ${user}'s ${b.merchant} bill only if it is safe and within their rules`);
  r.observe(
    `Received the ${b.merchant} bill`,
    `Billed ${b.amount}${b.usual > 0 ? `, the usual is ${b.usual}` : ", no prior amount on record"}`,
    { merchant: b.merchant, billed: b.amount, usual: b.usual },
  );

  const approved = APPROVED.has(b.merchant);
  r.tool(
    "Checked the biller against the approved list",
    approved ? `${b.merchant} is on ${user}'s approved list` : `${b.merchant} is NOT on ${user}'s approved list`,
    { approved },
  );
  if (!approved) {
    const rationale = `Refused ${b.merchant} ${b.amount}: not on ${user}'s list of approved billers, it could be a scam.`;
    r.decide("Refused: unknown biller", rationale);
    return { pay: false, rationale, reasoning: r.build(`Refused ${b.merchant} ${b.amount}`) };
  }

  r.think(
    "Checked the per-payment limit",
    `${b.amount} against ${user}'s ${PER_PAYMENT_CAP} per-payment limit`,
    { amount: b.amount, perPaymentCap: PER_PAYMENT_CAP },
  );
  if (b.amount > PER_PAYMENT_CAP) {
    const rationale = `Refused ${b.merchant} ${b.amount}: over ${user}'s ${PER_PAYMENT_CAP} per-payment limit, left for them to approve.`;
    r.decide("Refused: over the per-payment limit", rationale);
    return { pay: false, rationale, reasoning: r.build(`Refused ${b.merchant} ${b.amount}`) };
  }

  const overchargeLine = Math.round(b.usual * OVERPAY_TOLERANCE);
  r.think(
    "Compared against the usual amount",
    `${b.amount} against the usual ${b.usual}; anything over ${overchargeLine} is treated as a likely overcharge`,
    { billed: b.amount, usual: b.usual, overchargeLine },
  );
  if (b.usual > 0 && b.amount > overchargeLine) {
    const rationale = `Refused ${b.merchant} ${b.amount}: far above the usual ${b.usual}, a likely overcharge, left for ${user} to review.`;
    r.decide("Refused: likely overcharge", rationale);
    return { pay: false, rationale, reasoning: r.build(`Refused ${b.merchant} ${b.amount}`) };
  }

  const rationale = `Paid ${b.merchant} ${b.amount}: due now, matches the usual ${b.usual}, from an approved biller, and within ${user}'s ${PER_PAYMENT_CAP} limit.`;
  r.decide("Approved and paid", rationale);
  return { pay: true, rationale, reasoning: r.build(`Paid ${b.merchant} ${b.amount}`) };
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

// The two consumers. A user keypair only exists so the demo dashboard can decrypt "as" them; the
// agent only needs their address to seal each record to the right user.
function loadUser(envName: string): Ed25519Keypair {
  const k = process.env[envName];
  return k ? Ed25519Keypair.fromSecretKey(k) : new Ed25519Keypair();
}

async function main() {
  const keypair = loadKeypair();
  const address = keypair.getPublicKey().toSuiAddress();
  const sui = getSuiClient();
  const seal = getSealClient(sui);
  const walrus = getWalrusClient(sui);

  const alice = loadUser("AVOW_USER_A_KEY");
  const bob = loadUser("AVOW_USER_B_KEY");
  const consumers = [
    { name: "Alice", address: alice.getPublicKey().toSuiAddress(), key: alice.getSecretKey(), bills: ALICE_BILLS },
    { name: "Bob", address: bob.getPublicKey().toSuiAddress(), key: bob.getSecretKey(), bills: BOB_BILLS },
  ];

  let mandateId = process.env.AVOW_MANDATE_ID;
  let accessId = process.env.AVOW_ACCESS_ID;
  if (!mandateId || !accessId) {
    console.log("creating a mandate for the shared bill payer...");
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
  console.log(`\n--- demo consumers (embed these keys in the dashboard to view as them) ---`);
  for (const c of consumers) {
    console.log(`${c.name}:  address ${c.address}`);
    console.log(`       key     ${c.key}`);
  }
  console.log("");

  let paid = 0;
  let refused = 0;
  for (const consumer of consumers) {
    console.log(`=== serving ${consumer.name} (${consumer.address.slice(0, 10)}…) ===`);
    for (const bill of consumer.bills) {
      const { pay, rationale, reasoning } = decide(consumer.name, bill);

      let txDigests: string[] = [];
      if (pay) {
        const tx = new Transaction();
        const [coin] = tx.splitCoins(tx.gas, [1]);
        tx.transferObjects([coin], address);
        const tr = await sui.signAndExecuteTransaction({ transaction: tx, signer: keypair });
        txDigests = [tr.digest];
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
          user: consumer.address,
          reasoning,
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
      console.log(`  ${pay ? "PAID   " : "REFUSED"} ${bill.merchant} ${bill.amount}  ->  sealed to ${consumer.name}`);
      console.log(`          proof: https://suiscan.xyz/${NETWORK}/tx/${result.anchorDigest}`);
    }
  }

  console.log("\n-----------------------------------------------------------");
  console.log(`done. ${paid} paid, ${refused} refused across 2 consumers, each decision recorded,`);
  console.log(`reasoned, and sealed to its user.`);
  console.log(`\nmandate id (paste in the dashboard): ${mandateId}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
