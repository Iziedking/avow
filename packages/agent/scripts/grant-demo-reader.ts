// Mint a read-only "demo reader" key and grant it auditor access to the demo agents, so anyone
// can verify those agents on the dashboard without owning them. The key can only decrypt the
// demo agents' sealed evidence, nothing else: no funds, no anchoring, no granting.
//
// Run from the repo root: npx tsx packages/agent/scripts/grant-demo-reader.ts

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, PACKAGE_ID, NETWORK } from "avow-sdk";

const DEMO_MANDATES = [
  "0x745492d3c02d9095a81744a30024b72a27c5566229fa5db2fef672352012480f",
  "0x1d6d7892132773b525278fd714b2acbfa96fff762ae0a0c3b97bd094b89568db",
];

function loadOwner(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  const file = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(file.exportedPrivateKey as string);
}

async function accessIdFor(
  sui: ReturnType<typeof getSuiClient>,
  mandateId: string,
): Promise<string> {
  const res = await sui.queryEvents({
    query: { MoveEventType: `${PACKAGE_ID}::record::AccessCreated` },
    order: "descending",
    limit: 50,
  });
  const ev = res.data.find(
    (e) => String((e.parsedJson as Record<string, unknown>).mandate_id) === mandateId,
  );
  if (!ev) throw new Error(`no access object for ${mandateId}`);
  return String((ev.parsedJson as Record<string, unknown>).access_id);
}

async function capIdFor(
  sui: ReturnType<typeof getSuiClient>,
  owner: string,
  mandateId: string,
): Promise<string> {
  const res = await sui.getOwnedObjects({
    owner,
    filter: { StructType: `${PACKAGE_ID}::mandate::MandateCap` },
    options: { showContent: true },
  });
  for (const o of res.data) {
    const c = o.data?.content;
    if (c && c.dataType === "moveObject") {
      const f = (c as { fields: Record<string, unknown> }).fields;
      if (String(f.mandate_id) === mandateId) return o.data!.objectId;
    }
  }
  throw new Error(`no MandateCap owned for ${mandateId}`);
}

async function main() {
  const owner = loadOwner();
  const ownerAddr = owner.getPublicKey().toSuiAddress();
  const sui = getSuiClient();

  const reader = new Ed25519Keypair();
  const readerAddr = reader.getPublicKey().toSuiAddress();

  console.log(`network:           ${NETWORK}`);
  console.log(`owner:             ${ownerAddr}`);
  console.log(`demo reader addr:  ${readerAddr}`);
  console.log(`demo reader key:   ${reader.getSecretKey()}\n`);

  for (const m of DEMO_MANDATES) {
    const accessId = await accessIdFor(sui, m);
    const capId = await capIdFor(sui, ownerAddr, m);
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::record::add_auditor`,
      arguments: [tx.object(accessId), tx.object(capId), tx.pure.address(readerAddr)],
    });
    const res = await sui.signAndExecuteTransaction({
      transaction: tx,
      signer: owner,
      options: { showEffects: true },
    });
    console.log(`granted on ${m}`);
    console.log(`  tx ${res.digest}`);
  }

  console.log(`\ndone. paste the demo reader key above into DEMO_READER_KEY in web/src/config.ts`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
