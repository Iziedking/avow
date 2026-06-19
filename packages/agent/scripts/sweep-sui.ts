import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { readFileSync } from "node:fs";
import { getSuiClient } from "avow-sdk";
const sui = getSuiClient();
const PLATFORM = "0xc11c77d7f5f0555041e04a89a266edbe305da731c4f10c102bc4384536bbb65b";
(async () => {
  const ags = JSON.parse(readFileSync(".firecrawl/agents.json", "utf8"));
  for (const a of ags) {
    const kp = Ed25519Keypair.fromSecretKey(a.secretKey);
    const addr = kp.getPublicKey().toSuiAddress();
    const b = await sui.getBalance({ owner: addr });
    const suiBal = Number(b.totalBalance) / 1e9;
    if (suiBal > 0.15) {
      const amt = Math.floor((suiBal - 0.06) * 1e9); // leave 0.06 for gas
      try {
        const tx = new Transaction();
        const [c] = tx.splitCoins(tx.gas, [amt]);
        tx.transferObjects([c], PLATFORM);
        const r = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp });
        await sui.waitForTransaction({ digest: r.digest });
        console.log(addr.slice(0, 12), "swept", (amt / 1e9).toFixed(2), "SUI");
      } catch (e) { console.log(addr.slice(0, 12), "skip:", (e as Error).message.slice(0, 40)); }
    } else console.log(addr.slice(0, 12), suiBal.toFixed(3), "SUI (skip)");
  }
  console.log("platform SUI now:", (Number((await sui.getBalance({ owner: PLATFORM })).totalBalance) / 1e9).toFixed(3));
})().catch((e) => console.error("ERR", (e as Error).message));
