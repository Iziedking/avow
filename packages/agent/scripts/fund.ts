import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { requestSuiFromFaucetV2, getFaucetHost } from "@mysten/sui/faucet";
import { getSuiClient } from "avow-sdk";
const kp = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/devkey.json","utf8")).exportedPrivateKey);
const addr = kp.getPublicKey().toSuiAddress();
const sui = getSuiClient();
async function bal() {
  const b = await sui.getAllBalances({ owner: addr });
  return b.map(x=>x.coinType.split("::").pop()+": "+(Number(x.totalBalance)/1e9).toFixed(3)).join("  ");
}
async function main() {
  console.log("addr:", addr);
  console.log("before:", await bal());
  for (let i=0;i<2;i++) {
    try { await requestSuiFromFaucetV2({ host: getFaucetHost("testnet"), recipient: addr }); console.log("faucet ok", i); }
    catch(e){ console.log("faucet err", (e as Error).message.slice(0,60)); }
    await new Promise(r=>setTimeout(r,2500));
  }
  await new Promise(r=>setTimeout(r,4000));
  console.log("after:", await bal());
}
main().catch(e=>console.error("ERR",(e as Error).message));
