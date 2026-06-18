// One-off: gather the authoritative mainnet constants and check the dev wallet's mainnet funds
// before we publish. Run: npx tsx packages/agent/scripts/mainnet-precheck.ts

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

const DEV = "0xc11c77d7f5f0555041e04a89a266edbe305da731c4f10c102bc4384536bbb65b";

async function main() {
  const main = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("mainnet") });
  console.log("\n=== dev wallet on MAINNET ===");
  console.log("address:", DEV);
  const all = await main.getAllBalances({ owner: DEV });
  if (all.length === 0) {
    console.log("(no coins on mainnet — wallet is unfunded)");
  }
  for (const b of all) {
    console.log(`${b.coinType}  ->  ${b.totalBalance}`);
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
