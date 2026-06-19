import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getSuiClient, getSealClient, getWalrusClient, listRecords, createSession, verify } from "avow-sdk";
const API = "http://localhost:8787";
const platform = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/devkey.json","utf8")).exportedPrivateKey);
const sui = getSuiClient();
const post = async (p: string, b: unknown) => (await fetch(API+p,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)})).json();
// Fixed reusable test owner, so we never orphan a fresh key.
function owner(): Ed25519Keypair {
  if (existsSync(".firecrawl/test-owner.json")) return Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/test-owner.json","utf8")).key);
  const k = new Ed25519Keypair(); writeFileSync(".firecrawl/test-owner.json", JSON.stringify({ key: k.getSecretKey() })); return k;
}
async function main() {
  const o = owner();
  const oAddr = o.getPublicKey().toSuiAddress();
  console.log("reusable test identity:", oAddr);
  const claimed: any = await post("/claim", { owner: oAddr });
  if (claimed.error) return console.log("claim error:", claimed.error);
  console.log("claimed agent:", claimed.agentAddress?.slice(0,12), "mandate:", claimed.mandateId?.slice(0,12));
  const tx = new Transaction(); const [c] = tx.splitCoins(tx.gas, [1_500_000_000]); tx.transferObjects([c], claimed.agentAddress);
  const fr = await sui.signAndExecuteTransaction({ transaction: tx, signer: platform });
  await sui.waitForTransaction({ digest: fr.digest });
  console.log("funded agent 1.5 SUI (settled)");
  const out: any = await post("/agent", { mandateId: claimed.mandateId, instruction: "swap 1 SUI to stablecoin" });
  if (out.error) return console.log("agent error:", out.error);
  console.log("agent steps:", JSON.stringify(out.steps), "url:", out.swapUrl);
  await new Promise(r=>setTimeout(r,8000));
  const recs = await listRecords(sui, claimed.mandateId);
  console.log("\n=== identity verifies (granted at claim) ===  records:", recs.length);
  const session = await createSession(sui, o);
  for (const rec of recs) {
    const v = await verify({ suiClient: sui, sealClient: getSealClient(sui), walrusClient: getWalrusClient(sui), sessionKey: session, record: rec });
    console.log(v.hashMatches?"ok ":"FAIL", rec.actionType, "->", v.bundle.reasoning?.outcome);
    for (const s of v.bundle.reasoning?.steps ?? []) console.log("     ", s.kind.padEnd(7), s.title);
  }
}
main().catch(e=>console.error("ERR", (e as Error).message));
