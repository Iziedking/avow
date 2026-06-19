import { getSuiClient } from "avow-sdk";
const sui = getSuiClient();
async function main() {
  const b = await sui.getAllBalances({ owner: "0xc11c77d7f5f0555041e04a89a266edbe305da731c4f10c102bc4384536bbb65b" });
  for (const x of b) console.log(x.coinType, "=", (Number(x.totalBalance)/1e9).toFixed(3));
}
main().catch(e=>console.error(e));
