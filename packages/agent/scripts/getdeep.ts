import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { getSuiClient } from "avow-sdk";
const kp = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/devkey.json","utf8")).exportedPrivateKey);
const addr = kp.getPublicKey().toSuiAddress();
const sui = getSuiClient();
const db = new DeepBookClient({ client: sui as never, address: addr, network: "testnet" });
async function main() {
  console.log("DEEP_SUI params:", await db.poolBookParams("DEEP_SUI"));
  console.log("DEEP_SUI mid:", await db.midPrice("DEEP_SUI").catch((e)=>"none:"+(e as Error).message.slice(0,40)));
  const q = await db.getQuoteQuantityOutInputFee("DEEP_SUI", 50); // 50 DEEP base -> ? SUI (just to probe direction)
  console.log("probe:", q);
  // swap SUI(quote) -> DEEP(base), input fee
  const tx = new Transaction();
  const [b,qq,d] = tx.add(db.deepBook.swapExactQuoteForBase({ poolKey:"DEEP_SUI", amount: 3, deepAmount: 0, minOut: 0, payWithDeep: false }));
  tx.transferObjects([b,qq,d], addr);
  const r = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp, options:{ showBalanceChanges:true, showEffects:true } });
  console.log("tx", r.digest, JSON.stringify(r.effects?.status));
  for (const c of r.balanceChanges ?? []) console.log("  ", c.coinType.split("::").pop(), c.amount);
}
main().catch(e=>console.error("ERR", (e as Error).message));
