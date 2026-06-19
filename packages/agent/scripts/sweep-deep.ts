import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { readFileSync } from "node:fs";
import { getSuiClient } from "avow-sdk";
import { balance, execWithRetry, COIN_TYPE } from "./deepbook";
const sui = getSuiClient();
const PLATFORM = "0xc11c77d7f5f0555041e04a89a266edbe305da731c4f10c102bc4384536bbb65b";
(async () => {
  const ags = JSON.parse(readFileSync(".firecrawl/agents.json", "utf8"));
  for (const a of ags) {
    const kp = Ed25519Keypair.fromSecretKey(a.secretKey);
    const addr = kp.getPublicKey().toSuiAddress();
    const deep = await balance(addr, "DEEP");
    if (deep > 0.05) {
      await execWithRetry(async () => {
        const tx = new Transaction();
        const coins = await sui.getCoins({ owner: addr, coinType: COIN_TYPE.DEEP });
        const ids = coins.data.map((c) => tx.object(c.coinObjectId));
        if (ids.length > 1) tx.mergeCoins(ids[0], ids.slice(1));
        tx.transferObjects([ids[0]], PLATFORM);
        return tx;
      }, kp);
      console.log(addr.slice(0, 12), "swept", deep.toFixed(3), "DEEP -> platform");
    } else console.log(addr.slice(0, 12), "DEEP", deep.toFixed(4), "(skip)");
  }
  console.log("platform DEEP now:", (await balance(PLATFORM, "DEEP")).toFixed(3));
})().catch((e) => console.error("ERR", (e as Error).message));
