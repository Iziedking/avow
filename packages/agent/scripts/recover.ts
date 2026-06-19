import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { getSuiClient } from "avow-sdk";
const kp = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/devkey.json","utf8")).exportedPrivateKey);
const addr = kp.getPublicKey().toSuiAddress();
const sui = getSuiClient();
const MANAGERS = ["0x9750f482ed75267a1c0b90b572888a60db22d956850acb4885a419bff30fd381","0xc960f707ef1a4f1ad3b5f700be8effafbd3e85a6d8ee0cb4e296dc1cc7646e9e"];
async function main() {
  for (const m of MANAGERS) {
    const db = new DeepBookClient({ client: sui as never, address: addr, network: "testnet", balanceManagers: { M: { address: m } } });
    const tx = new Transaction();
    try { tx.add(db.deepBook.cancelAllOrders({ poolKey: "SUI_DBUSDC", balanceManagerKey: "M" })); } catch {}
    try { tx.add(db.balanceManager.withdrawAllFromManager("M", "SUI", addr)); } catch {}
    try { tx.add(db.balanceManager.withdrawAllFromManager("M", "DBUSDC", addr)); } catch {}
    try {
      const r = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp, options:{ showEffects:true } });
      console.log(m.slice(0,10), JSON.stringify(r.effects?.status));
    } catch(e){ console.log(m.slice(0,10), "skip:", (e as Error).message.slice(0,50)); }
  }
  const b = await sui.getAllBalances({ owner: addr });
  console.log("free now:", b.map(x=>x.coinType.split("::").pop()+": "+(Number(x.totalBalance)/1e9).toFixed(3)).join("  "));
}
main().catch(e=>console.error("ERR",(e as Error).message));
