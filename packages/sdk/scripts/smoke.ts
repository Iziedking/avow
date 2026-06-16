// Connectivity smoke test. Constructs all three clients against the configured network and
// reads the live avow package, proving the verified wiring actually talks to testnet.
//
// Run: npx tsx packages/sdk/scripts/smoke.ts

import { getSuiClient, getSealClient, getWalrusClient } from "../src/clients";
import { PACKAGE_ID, NETWORK, SEAL_KEY_SERVERS, SEAL_THRESHOLD } from "../src/config";

async function main() {
  console.log(`network: ${NETWORK}`);
  console.log(`package: ${PACKAGE_ID}`);

  const sui = getSuiClient();

  const record = await sui.getNormalizedMoveModule({ package: PACKAGE_ID, module: "record" });
  console.log("record functions:", Object.keys(record.exposedFunctions).join(", "));

  const mandate = await sui.getNormalizedMoveModule({ package: PACKAGE_ID, module: "mandate" });
  console.log("mandate functions:", Object.keys(mandate.exposedFunctions).join(", "));

  // Construct the Seal and Walrus clients to confirm the shared Sui client satisfies both.
  const seal = getSealClient(sui);
  const walrus = getWalrusClient(sui);
  console.log(`seal client built with ${SEAL_KEY_SERVERS.length} key servers, threshold ${SEAL_THRESHOLD}`);
  console.log(`walrus client built: ${walrus.constructor.name}`);
  void seal;

  console.log("OK");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
