import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { readFileSync } from "node:fs";
import { getSuiClient, getSealClient, getWalrusClient, listRecords, createSession, verify } from "avow-sdk";
const sui = getSuiClient();
const owner = Ed25519Keypair.fromSecretKey(JSON.parse(readFileSync(".firecrawl/test-owner.json", "utf8")).key);
const ags = JSON.parse(readFileSync(".firecrawl/agents.json", "utf8"));
const MANDATE = ags[ags.length - 1].mandateId;
(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  const recs = await listRecords(sui, MANDATE);
  console.log("mandate", MANDATE.slice(0, 12), "records:", recs.length);
  const session = await createSession(sui, owner);
  for (const rec of recs) {
    const v = await verify({ suiClient: sui, sealClient: getSealClient(sui), walrusClient: getWalrusClient(sui), sessionKey: session, record: rec });
    console.log("\n" + (v.hashMatches ? "VERIFIED" : "FAIL"), "| constraint:", (v.bundle.observed as any)?.constraints?.summary);
    console.log("goal:", v.bundle.reasoning?.goal);
    for (const s of v.bundle.reasoning?.steps ?? []) console.log("  ", s.kind.padEnd(7), s.title, s.detail ? "— " + s.detail : "");
    console.log("outcome:", v.bundle.reasoning?.outcome);
  }
})().catch((e) => console.error("ERR", (e as Error).message));
