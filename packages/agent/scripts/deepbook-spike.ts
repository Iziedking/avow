// Spike: prove an agent can do one real DeepBook v3 swap on Sui testnet, end to end.
// Swaps a little SUI for DBUSDC on the SUI_DBUSDC pool, fee paid in the input coin (no DEEP).
// If this works, the real-platform demo works. Run: npx tsx packages/agent/scripts/deepbook-spike.ts

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

const SUI_IN = 1; // swap 1 SUI -> DBUSDC (>= the pool's minSize of 1)

async function main() {
  const kp = loadKeypair();
  const addr = kp.getPublicKey().toSuiAddress();
  // The DeepBook SDK wants a SuiClient-shaped client; our getSuiClient() returns the 2.x jsonRpc one.
  const sui = getSuiClient();
  const db = new DeepBookClient({ client: sui as never, address: addr, network: "testnet" });

  console.log("address:", addr);

  // 1. Read the market: what would this swap return, and does it need DEEP?
  const q = await db.getQuoteQuantityOut("SUI_DBUSDC", SUI_IN);
  console.log("quote (DEEP-fee path):", q);
  const qi = await db.getQuoteQuantityOutInputFee("SUI_DBUSDC", SUI_IN);
  console.log("quote (input-fee path):", qi);

  // 2. Build the swap. Pay the fee in the input coin (deepAmount 0), so no DEEP is needed.
  const tx = new Transaction();
  const [baseOut, quoteOut, deepOut] = tx.add(
    db.deepBook.swapExactBaseForQuote({
      poolKey: "SUI_DBUSDC",
      amount: SUI_IN,
      deepAmount: 0,
      minOut: 0,
      payWithDeep: false,
    }),
  );
  tx.transferObjects([baseOut, quoteOut, deepOut], addr);

  // 3. Execute for real.
  const res = await sui.signAndExecuteTransaction({
    transaction: tx,
    signer: kp,
    options: { showEffects: true, showBalanceChanges: true },
  });
  console.log("\nswap tx:", res.digest);
  console.log("status:", JSON.stringify(res.effects?.status));
  console.log("balance changes:");
  for (const b of res.balanceChanges ?? []) {
    console.log(`  ${b.coinType.split("::").pop()}  ${b.amount}`);
  }
  console.log(`\nexplorer: https://suiscan.xyz/testnet/tx/${res.digest}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
