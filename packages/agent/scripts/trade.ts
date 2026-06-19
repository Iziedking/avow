// Give the DeepBook trading agent a live instruction and watch it act, then verify on Avow.
//
//   npx tsx packages/agent/scripts/trade.ts <amountSUI>
//
// It swaps <amountSUI> SUI for DBUSDC on DeepBook (real, on-chain), records the action with its
// full reasoning and the real swap tx, and prints the mandate id to paste into the dashboard.
// Records accumulate under one mandate (set AVOW_MANDATE_ID to use your own).

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";
import {
  getSuiClient,
  getSealClient,
  getWalrusClient,
  anchor,
  Reasoning,
  EVIDENCE_VERSION,
  PACKAGE_ID,
  NETWORK,
} from "avow-sdk";

const POOL = "SUI_DBUSDC";
const MANDATE = process.env.AVOW_MANDATE_ID ?? "0x75d864b1e4d095b34872eb6c554fcbb3164185c7d2f5a72b478498fe745bc2f9";
const AMOUNT = Math.max(1, Math.round((Number(process.argv[2] ?? "1")) * 10) / 10); // >= 1 SUI, lot 0.1

function loadKeypair(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  const f = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(f.exportedPrivateKey as string);
}

async function accessIdFor(sui: ReturnType<typeof getSuiClient>, mandateId: string): Promise<string> {
  const res = await sui.queryEvents({
    query: { MoveEventType: `${PACKAGE_ID}::record::AccessCreated` },
    order: "descending",
    limit: 50,
  });
  const ev = res.data.find((e) => String((e.parsedJson as Record<string, unknown>).mandate_id) === mandateId);
  if (!ev) throw new Error(`no access for ${mandateId}`);
  return String((ev.parsedJson as Record<string, unknown>).access_id);
}

async function main() {
  const kp = loadKeypair();
  const addr = kp.getPublicKey().toSuiAddress();
  const sui = getSuiClient();
  const seal = getSealClient(sui);
  const walrus = getWalrusClient(sui);
  const db = new DeepBookClient({ client: sui as never, address: addr, network: "testnet" });

  const accessId = await accessIdFor(sui, MANDATE);

  // Make sure the agent holds a little DEEP for the swap fee.
  const deepBal = await sui.getBalance({ owner: addr, coinType: `0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP` });
  if (Number(deepBal.totalBalance) < 1_000_000) {
    console.log("topping up DEEP for fees...");
    const t = new Transaction();
    const [b, q, d] = t.add(db.deepBook.swapExactQuoteForBase({ poolKey: "DEEP_SUI", amount: 0.5, deepAmount: 0, minOut: 0, payWithDeep: false }));
    t.transferObjects([b, q, d], addr);
    await sui.signAndExecuteTransaction({ transaction: t, signer: kp });
  }

  // Read the live market and decide.
  const mid = await db.midPrice(POOL);
  const quote = await db.getQuoteQuantityOut(POOL, AMOUNT);
  console.log(`\ninstruction:  swap ${AMOUNT} SUI -> DBUSDC`);
  console.log(`market:       SUI/DBUSDC mid ${mid.toFixed(4)}; expected out ~${quote.quoteOut.toFixed(4)} DBUSDC\n`);

  const r = new Reasoning(`Swap ${AMOUNT} SUI for DBUSDC stablecoin as instructed`);
  r.observe("Read the DeepBook SUI/DBUSDC market", `mid price ${mid.toFixed(4)} DBUSDC per SUI`, { mid });
  r.tool("Quoted the swap on DeepBook", `${AMOUNT} SUI routes to ~${quote.quoteOut.toFixed(4)} DBUSDC`, quote);
  r.think("Checked it against the mandate limits", `${AMOUNT} SUI within the per-action cap`);
  r.decide("Execute the swap on DeepBook", `take ~${quote.quoteOut.toFixed(4)} DBUSDC`);
  const reasoning = r.build(`Swapped ${AMOUNT} SUI for ~${quote.quoteOut.toFixed(4)} DBUSDC on DeepBook`);

  const tx = new Transaction();
  const [b, q, d] = tx.add(db.deepBook.swapExactBaseForQuote({ poolKey: POOL, amount: AMOUNT, deepAmount: quote.deepRequired, minOut: 0 }));
  tx.transferObjects([b, q, d], addr);
  const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });

  console.log(`RESULT:  swapped ${AMOUNT} SUI -> ~${quote.quoteOut.toFixed(4)} DBUSDC`);
  console.log(`         on-chain: https://suiscan.xyz/${NETWORK}/tx/${res.digest}`);

  await anchor({
    suiClient: sui,
    sealClient: seal,
    walrusClient: walrus,
    signer: kp,
    mandateId: MANDATE,
    accessId,
    bundle: {
      version: EVIDENCE_VERSION,
      mandateId: MANDATE,
      agent: addr,
      user: addr,
      reasoning,
      actionType: "swap",
      target: "deepbook:SUI/DBUSDC",
      amount: BigInt(Math.round(AMOUNT * 1e9)).toString(),
      rationale: reasoning.outcome,
      observed: { mid, quote },
      txDigests: [res.digest],
      timestampMs: Date.now(),
    },
  });

  console.log(`         recorded on Avow.\n`);
  console.log(`verify it: open the dashboard, connect a reader wallet, paste the mandate:`);
  console.log(`  ${MANDATE}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
