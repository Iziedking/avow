import { getSuiClient } from "avow-sdk";
const sui = getSuiClient();
async function main() {
  const o = await sui.getObject({ id: "0xf4d164ea2def5fe07dc573992a029e010dba09b1a8dcbc44c5c2e79567f39073", options: { showType: true } });
  console.log("type:", o.data?.type);
}
main().catch(e=>console.error(e));
