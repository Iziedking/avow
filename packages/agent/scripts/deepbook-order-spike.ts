// Spike step 2: prove the agent can place a real limit order on DeepBook testnet (a maker order
// that rests on the book, so it works regardless of counterparty liquidity). Creates a
// BalanceManager, deposits SUI, and places a resting sell order.
// Run: npx tsx packages/agent/scripts/deepbook-order-spike.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { getSuiClient } from "avow-sdk";

function loadKeypair(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  const f = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(f.exportedPrivateKey as string);
}

async function main() {
  const kp = loadKeypair();
  const addr = kp.getPublicKey().toSuiAddress();
  const sui = getSuiClient();
  let db = new DeepBookClient({ client: sui as never, address: addr, network: "testnet" });

  // 1. Create + share a BalanceManager.
  const tx1 = new Transaction();
  tx1.add(db.balanceManager.createAndShareBalanceManager());
  const r1 = await sui.signAndExecuteTransaction({
    transaction: tx1,
    signer: kp,
    options: { showObjectChanges: true },
  });
  const created = (r1.objectChanges ?? []).find(
    (c) => c.type === "created" && String((c as { objectType?: string }).objectType).includes("BalanceManager"),
  );
  const managerId = (created as { objectId?: string } | undefined)?.objectId;
  console.log("BalanceManager:", managerId, " tx", r1.digest);
  if (!managerId) throw new Error("no BalanceManager created");

  // 2. Rebuild the client now that it knows the manager.
  db = new DeepBookClient({
    client: sui as never,
    address: addr,
    network: "testnet",
    balanceManagers: { MANAGER: { address: managerId } },
  });

  // 3. Deposit SUI and place a resting sell order (0.5 SUI at 5 DBUSDC, well above market so it rests).
  const tx2 = new Transaction();
  tx2.add(db.balanceManager.depositIntoManager("MANAGER", "SUI", 2));
  tx2.add(
    db.deepBook.placeLimitOrder({
      poolKey: "SUI_DBUSDC",
      balanceManagerKey: "MANAGER",
      clientOrderId: "1",
      price: 5,
      quantity: 1,
      isBid: false,
      payWithDeep: false,
    }),
  );
  const r2 = await sui.signAndExecuteTransaction({
    transaction: tx2,
    signer: kp,
    options: { showEffects: true },
  });
  console.log("order tx:", r2.digest, JSON.stringify(r2.effects?.status));
  console.log(`explorer: https://suiscan.xyz/testnet/tx/${r2.digest}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
