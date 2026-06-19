import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { readFileSync } from "node:fs";
import { getSuiClient } from "avow-sdk";
const API = process.env.AGENT_API ?? "http://localhost:8799";
const platform = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8")).exportedPrivateKey);
const sui = getSuiClient();
const post = async (p: string, b: unknown) => (await fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
const owner = () => Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/test-owner.json", "utf8")).key);
async function main() {
  const o = owner(); const oAddr = o.getPublicKey().toSuiAddress();
  const claimed: any = await post("/claim", { owner: oAddr });
  if (claimed.error) return console.log("claim err:", claimed.error);
  console.log("agent", claimed.agentAddress.slice(0, 12), "| mandate", claimed.mandateId.slice(0, 12));
  const tx = new Transaction(); const [c] = tx.splitCoins(tx.gas, [2_000_000_000]); tx.transferObjects([c], claimed.agentAddress);
  const fr = await sui.signAndExecuteTransaction({ transaction: tx, signer: platform }); await sui.waitForTransaction({ digest: fr.digest });
  console.log("funded 2 SUI\n");
  console.log("--- STEP 1: buy ---");
  const r1: any = await post("/agent", { mandateId: claimed.mandateId, instruction: "swap 1 SUI to USDC" });
  console.log("reply:", r1.reply); console.log("did:", JSON.stringify(r1.steps), r1.error ? "err:" + r1.error : "");
  console.log("\n(waiting for memory to index on Walrus...)\n");
  await new Promise((r) => setTimeout(r, 8000));
  console.log("--- STEP 2: sell only if in profit (memory recall) ---");
  const r2: any = await post("/agent", { mandateId: claimed.mandateId, instruction: "sell my USDC back to SUI, but only if I would make a profit on what I paid" });
  console.log("reply:", r2.reply); console.log("did:", JSON.stringify(r2.steps), r2.error ? "err:" + r2.error : "");
}
main().catch((e) => console.error("ERR", (e as Error).message));
