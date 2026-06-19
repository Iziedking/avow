import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { getSuiClient, getSealClient, getWalrusClient, listRecords, createSession, verify } from "avow-sdk";
const kp = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/devkey.json","utf8")).exportedPrivateKey);
const sui = getSuiClient();
const MANDATE = "0x75d864b1e4d095b34872eb6c554fcbb3164185c7d2f5a72b478498fe745bc2f9";
async function main() {
  console.log("owner:", kp.getPublicKey().toSuiAddress());
  const recs = await listRecords(sui, MANDATE);
  const session = await createSession(sui, kp);
  for (const r of recs) {
    const res = await verify({ suiClient: sui, sealClient: getSealClient(sui), walrusClient: getWalrusClient(sui), sessionKey: session, record: r });
    console.log(`\n${res.hashMatches ? "ok  " : "FAIL"} ${r.actionType}  tx ${r.txDigest?.slice(0,10)}  ->  ${res.bundle.reasoning?.outcome}`);
    for (const s of res.bundle.reasoning?.steps ?? []) console.log(`       ${s.kind.padEnd(8)} ${s.title}`);
  }
}
main().catch(e=>console.error("ERR", (e as Error).message));
