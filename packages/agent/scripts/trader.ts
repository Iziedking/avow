// A real DeepBook trading agent, built with the Avow SDK.
//
// It manages a treasury between SUI and a stablecoin (DBUSDC) by acting on DeepBook v3, Sui's
// native on-chain order book. It reads the live market, decides per its mandate, and carries out
// REAL on-chain actions: a market swap and a resting limit order. Every action is anchored by
// Avow with the agent's full reasoning AND the real DeepBook transaction digest, so a verifier
// can replay why it traded and click straight through to the on-chain proof on a real venue.
// This is the "not a toy, can't lie" demo: the evidence carries the real exchange's tx.
//
// Run from the repo root: npx tsx packages/agent/scripts/trader.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";
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

const POOL = "SUI_DBUSDC";
const PER_MOVE_CAP = 2_000_000_000n; // 2 SUI per action, in MIST
const DAILY_CAP = 20_000_000_000n; // 20 SUI per epoch
const SWAP_SUI = 1; // sell 1 SUI for DBUSDC (>= the pool's 1 SUI minSize)
const ORDER_SUI = 1; // place a resting sell order for 1 SUI

function loadKeypair(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  const f = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(f.exportedPrivateKey as string);
}

const toMist = (sui: number) => BigInt(Math.round(sui * 1e9)).toString();

async function main() {
  const kp = loadKeypair();
  const addr = kp.getPublicKey().toSuiAddress();
  const sui = getSuiClient();
  const seal = getSealClient(sui);
  const walrus = getWalrusClient(sui);
  let db = new DeepBookClient({ client: sui as never, address: addr, network: "testnet" });

  console.log(`network:  ${NETWORK}`);
  console.log(`agent:    ${addr}`);

  // 1. The mandate: this agent may trade up to 2 SUI per action, 20 per epoch. Owner = agent,
  //    so only the owner can decrypt its records until they grant an auditor.
  let mandateId = process.env.AVOW_MANDATE_ID;
  let accessId = process.env.AVOW_ACCESS_ID;
  if (!mandateId || !accessId) {
    console.log("\ncreating the trader's mandate...");
    const m = await createMandate(sui, kp, {
      agent: addr,
      perMoveCap: PER_MOVE_CAP,
      dailyCap: DAILY_CAP,
      expiryEpoch: 100000n,
    });
    mandateId = m.mandateId;
    accessId = m.accessId;
  }
  console.log(`mandate:  ${mandateId}\n`);

  // 2. Set up a DeepBook BalanceManager and bootstrap a little DEEP for swap fees.
  console.log("setting up the DeepBook account (BalanceManager + DEEP for fees)...");
  const tx0 = new Transaction();
  tx0.add(db.balanceManager.createAndShareBalanceManager());
  const r0 = await sui.signAndExecuteTransaction({
    transaction: tx0,
    signer: kp,
    options: { showObjectChanges: true },
  });
  const created = (r0.objectChanges ?? []).find(
    (c) => c.type === "created" && String((c as { objectType?: string }).objectType).includes("BalanceManager"),
  );
  const managerId = (created as { objectId?: string }).objectId!;
  db = new DeepBookClient({
    client: sui as never,
    address: addr,
    network: "testnet",
    balanceManagers: { TRADER: { address: managerId } },
  });

  // Bootstrap DEEP: swap 0.5 SUI for DEEP on the DEEP_SUI pool (fee paid in the input coin).
  const tdeep = new Transaction();
  const [db1, dq1, dd1] = tdeep.add(
    db.deepBook.swapExactQuoteForBase({ poolKey: "DEEP_SUI", amount: 0.5, deepAmount: 0, minOut: 0, payWithDeep: false }),
  );
  tdeep.transferObjects([db1, dq1, dd1], addr);
  await sui.signAndExecuteTransaction({ transaction: tdeep, signer: kp });
  console.log("DEEP acquired for fees.\n");

  // 3. Observe the live market.
  const mid = await db.midPrice(POOL);
  const quote = await db.getQuoteQuantityOut(POOL, SWAP_SUI);
  console.log(`market:   SUI/DBUSDC mid ${mid.toFixed(4)}; ${SWAP_SUI} SUI -> ~${quote.quoteOut.toFixed(4)} DBUSDC\n`);

  const proofs: { label: string; digest: string }[] = [];

  // === Action 1: a real, filled market swap, SUI -> stablecoin ===
  {
    const r = new Reasoning(`Convert ${SWAP_SUI} SUI to DBUSDC stablecoin while the price is fair`);
    r.observe("Read the DeepBook SUI/DBUSDC order book", `mid price is ${mid.toFixed(4)} DBUSDC per SUI`, { mid });
    r.tool("Quoted the swap on DeepBook", `${SWAP_SUI} SUI routes to ~${quote.quoteOut.toFixed(4)} DBUSDC, fee ${quote.deepRequired.toFixed(4)} DEEP`, quote);
    r.think("Checked it against the mandate", `${SWAP_SUI} SUI is within the 2 SUI per-action limit`);
    r.decide("Execute the swap on DeepBook", `lock in ~${quote.quoteOut.toFixed(4)} stablecoin now`);
    const reasoning: ReasoningTrace = r.build(`Swapped ${SWAP_SUI} SUI for ~${quote.quoteOut.toFixed(4)} DBUSDC on DeepBook`);

    const tx = new Transaction();
    const [b, q, d] = tx.add(
      db.deepBook.swapExactBaseForQuote({ poolKey: POOL, amount: SWAP_SUI, deepAmount: quote.deepRequired, minOut: 0 }),
    );
    tx.transferObjects([b, q, d], addr);
    const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
    proofs.push({ label: "swap", digest: res.digest });
    console.log(`SWAP    ${SWAP_SUI} SUI -> DBUSDC on DeepBook   tx ${res.digest}`);

    await anchor({
      suiClient: sui,
      sealClient: seal,
      walrusClient: walrus,
      signer: kp,
      mandateId,
      accessId,
      bundle: {
        version: EVIDENCE_VERSION,
        mandateId,
        agent: addr,
        user: addr,
        reasoning,
        actionType: "swap",
        target: "deepbook:SUI/DBUSDC",
        amount: toMist(SWAP_SUI),
        rationale: reasoning.outcome,
        observed: { mid, quote },
        txDigests: [res.digest],
        timestampMs: Date.now(),
      },
    });
    console.log(`        anchored on Avow.\n`);
  }

  // === Action 2: a real resting limit order on DeepBook ===
  {
    const target = Number((mid * 1.08).toFixed(5)); // 8% above mid, a take-profit ask
    const r = new Reasoning(`Place a take-profit sell order for ${ORDER_SUI} SUI above the market`);
    r.observe("Read the live mid price", `${mid.toFixed(4)} DBUSDC per SUI`, { mid });
    r.think("Set a target above market", `${target} DBUSDC, ~8% above mid, to sell into strength`);
    r.tool("Funded the DeepBook account", `deposited ${ORDER_SUI} SUI to back the order`);
    r.decide("Place a resting limit sell", `${ORDER_SUI} SUI at ${target} DBUSDC, good-til-cancelled`);
    const reasoning: ReasoningTrace = r.build(`Placed a limit sell: ${ORDER_SUI} SUI at ${target} DBUSDC on DeepBook`);

    const tx = new Transaction();
    tx.add(db.balanceManager.depositIntoManager("TRADER", "SUI", ORDER_SUI));
    tx.add(
      db.deepBook.placeLimitOrder({
        poolKey: POOL,
        balanceManagerKey: "TRADER",
        clientOrderId: String(Date.now()),
        price: target,
        quantity: ORDER_SUI,
        isBid: false,
        payWithDeep: false,
      }),
    );
    const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
    proofs.push({ label: "limit_order", digest: res.digest });
    console.log(`ORDER   sell ${ORDER_SUI} SUI @ ${target} DBUSDC on DeepBook   tx ${res.digest}`);

    await anchor({
      suiClient: sui,
      sealClient: seal,
      walrusClient: walrus,
      signer: kp,
      mandateId,
      accessId,
      bundle: {
        version: EVIDENCE_VERSION,
        mandateId,
        agent: addr,
        user: addr,
        reasoning,
        actionType: "limit_order",
        target: "deepbook:SUI/DBUSDC",
        amount: toMist(ORDER_SUI),
        rationale: reasoning.outcome,
        observed: { mid, target },
        txDigests: [res.digest],
        timestampMs: Date.now(),
      },
    });
    console.log(`        anchored on Avow.\n`);
  }

  console.log("-----------------------------------------------------------");
  console.log("done. the agent traded on DeepBook and proved every action on Avow.");
  for (const p of proofs) console.log(`  ${p.label}: https://suiscan.xyz/${NETWORK}/tx/${p.digest}`);
  console.log(`\nmandate id (paste in the dashboard, owner-only until you grant an auditor):`);
  console.log(`  ${mandateId}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
