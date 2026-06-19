import { getSuiClient, listRecords } from "avow-sdk";
const sui = getSuiClient();
async function main() {
  const recs = await listRecords(sui, "0x75d864b1e4d095b34872eb6c554fcbb3164185c7d2f5a72b478498fe745bc2f9");
  console.log("listRecords returned:", recs.length);
  for (const r of recs) console.log("  ", r.actionType, r.target, "user", r.user?.slice(0,8));
}
main().catch(e=>console.error("ERR", (e as Error).message));
