import { getSuiClient, PACKAGE_ID, ORIGINAL_PACKAGE_ID } from "avow-sdk";
const sui = getSuiClient();
const MANDATE = "0x75d864b1e4d095b34872eb6c554fcbb3164185c7d2f5a72b478498fe745bc2f9";
async function main() {
  console.log("SDK PACKAGE_ID:", PACKAGE_ID);
  console.log("SDK ORIGINAL_PACKAGE_ID:", ORIGINAL_PACKAGE_ID);
  const res = await sui.queryEvents({ query: { MoveEventType: `${ORIGINAL_PACKAGE_ID}::record::ActionAnchored` }, order: "descending", limit: 10 });
  console.log("recent ActionAnchored events:", res.data.length);
  for (const e of res.data.slice(0,6)) {
    const j = e.parsedJson as any;
    console.log("  mandate", String(j.mandate_id).slice(0,12), "user", String(j.user||"").slice(0,8), "type", String.fromCharCode(...(j.action_type||[])).slice(0,12));
  }
  const mine = res.data.filter(e => String((e.parsedJson as any).mandate_id) === MANDATE);
  console.log("matching trader mandate:", mine.length);
}
main().catch(e=>console.error("ERR", (e as Error).message));
