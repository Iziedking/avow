// Tidy the dev wallet: it accumulated a mandate (an agent) for every test run, which clutters
// "Your agents" on the dashboard. This transfers all of those leftover MandateCaps to the burn
// address, keeping only the two demo agents. The mandates and their records stay on chain; only
// the owner caps for the junk test agents are retired.
//
// Run from the repo root: npx tsx packages/agent/scripts/tidy-agents.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, PACKAGE_ID } from "avow-sdk";

const KEEP = new Set([
  "0x745492d3c02d9095a81744a30024b72a27c5566229fa5db2fef672352012480f",
  "0x1d6d7892132773b525278fd714b2acbfa96fff762ae0a0c3b97bd094b89568db",
]);

const BURN = "0x0000000000000000000000000000000000000000000000000000000000000000";

function loadOwner(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  const file = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(file.exportedPrivateKey as string);
}

async function main() {
  const owner = loadOwner();
  const addr = owner.getPublicKey().toSuiAddress();
  const sui = getSuiClient();

  const res = await sui.getOwnedObjects({
    owner: addr,
    filter: { StructType: `${PACKAGE_ID}::mandate::MandateCap` },
    options: { showContent: true },
  });

  const toBurn: string[] = [];
  for (const o of res.data) {
    const c = o.data?.content;
    if (c && c.dataType === "moveObject") {
      const f = (c as { fields: Record<string, unknown> }).fields;
      const mandateId = String(f.mandate_id);
      if (!KEEP.has(mandateId)) toBurn.push(o.data!.objectId);
    }
  }

  console.log(`owner:        ${addr}`);
  console.log(`caps owned:   ${res.data.length}`);
  console.log(`keeping:      ${res.data.length - toBurn.length} (the demo agents)`);
  console.log(`retiring:     ${toBurn.length} leftover test agents\n`);

  if (toBurn.length === 0) {
    console.log("nothing to tidy.");
    return;
  }

  const tx = new Transaction();
  tx.transferObjects(
    toBurn.map((id) => tx.object(id)),
    BURN,
  );
  const r = await sui.signAndExecuteTransaction({
    transaction: tx,
    signer: owner,
    options: { showEffects: true },
  });
  console.log(`tidied ${toBurn.length} test agents. tx ${r.digest}`);
  console.log(`"Your agents" now shows only the demo agents for this wallet.`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
