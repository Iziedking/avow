import { DeepBookClient } from "@mysten/deepbook-v3";
import { getSuiClient } from "avow-sdk";
async function main() {
  const sui = getSuiClient();
  const db = new DeepBookClient({ client: sui as never, address: "0xc11c77d7f5f0555041e04a89a266edbe305da731c4f10c102bc4384536bbb65b", network: "testnet" });
  console.log("SUI_DBUSDC poolBookParams:", await db.poolBookParams("SUI_DBUSDC"));
  console.log("mid SUI_DBUSDC:", await db.midPrice("SUI_DBUSDC").catch((e) => "no mid: " + (e as Error).message.slice(0,50)));
}
main().catch((e) => console.error("ERR", e));
