import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { readFileSync, writeFileSync } from "node:fs";
import { getSuiClient } from "avow-sdk";
const API = process.env.AGENT_API ?? "http://localhost:8799";
const MODE = process.env.MODE ?? "buy";
const STATE = ".firecrawl/xsession.json";
const platform = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8")).exportedPrivateKey);
const sui = getSuiClient();
const post = async (p: string, b: unknown) => (await fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
const owner = () => Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/test-owner.json", "utf8")).key);
async function main() {
  const oAddr = owner().getPublicKey().toSuiAddress();
  if (MODE === "buy") {
    const claimed: any = await post("/claim", { owner: oAddr });
    if (claimed.error) return console.log("claim err:", claimed.error);
    const tx = new Transaction(); const [c] = tx.splitCoins(tx.gas, [2_000_000_000]); tx.transferObjects([c], claimed.agentAddress);
    const fr = await sui.signAndExecuteTransaction({ transaction: tx, signer: platform }); await sui.waitForTransaction({ digest: fr.digest });
    console.log("agent", claimed.agentAddress.slice(0, 12), "funded 2 SUI");
    const r: any = await post("/agent", { mandateId: claimed.mandateId, instruction: "swap 1 SUI to USDC" });
    console.log("SESSION 1 reply:", r.reply); console.log("did:", JSON.stringify(r.steps), r.error ? "err:" + r.error : "");
    writeFileSync(STATE, JSON.stringify({ mandateId: claimed.mandateId }));
  } else {
    const { mandateId } = JSON.parse(readFileSync(STATE, "utf8"));
    const r: any = await post("/agent", { mandateId, instruction: "what have we done together so far? just tell me, no trade." });
    console.log("recalled from Walrus:", r.recalled);
    console.log("SESSION 2 reply:", r.reply); console.log("did:", JSON.stringify(r.steps), r.error ? "err:" + r.error : "");
  }
}
main().catch((e) => console.error("ERR", (e as Error).message));
