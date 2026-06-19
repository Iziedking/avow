import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { readFileSync } from "node:fs";
import { getSuiClient } from "avow-sdk";
const EXCHANGE_PKG = "0x82593828ed3fcb8c6a235eac9abd0adbe9c5f9bbffa9b1e7a45cdd884481ef9f";
const EXCHANGE_ID = "0xf4d164ea2def5fe07dc573992a029e010dba09b1a8dcbc44c5c2e79567f39073";
const WAL_TYPE = "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL";
const kp = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/devkey.json","utf8")).exportedPrivateKey);
const addr = kp.getPublicKey().toSuiAddress();
const sui = getSuiClient();
(async()=>{
  const wal = await sui.getCoins({ owner: addr, coinType: WAL_TYPE });
  const tx = new Transaction();
  const [pay] = tx.splitCoins(tx.object(wal.data[0].coinObjectId), [1_200_000_000]); // 1.2 WAL
  const out = tx.moveCall({ target: `${EXCHANGE_PKG}::wal_exchange::exchange_all_for_sui`, arguments: [tx.object(EXCHANGE_ID), pay] });
  tx.transferObjects([out], addr);
  const r = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp });
  await sui.waitForTransaction({ digest: r.digest });
  const s = await sui.getBalance({ owner: addr });
  console.log("swapped 1.2 WAL -> SUI. platform SUI now:", (Number(s.totalBalance)/1e9).toFixed(3));
})().catch(e=>console.error("ERR", (e as Error).message));
