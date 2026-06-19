// Grant an auditor read access to a mandate's evidence, signed by the owner (who holds the cap).
// The auditor can then decrypt and verify the records, without being trusted with anything else.
//
// Run: npx tsx packages/agent/scripts/grant-auditor.ts <mandateId> <auditorAddress>
// Defaults to the DeepBook trader mandate and the demo browser wallet.

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, PACKAGE_ID } from "avow-sdk";

const MANDATE =
  process.argv[2] ?? "0x75d864b1e4d095b34872eb6c554fcbb3164185c7d2f5a72b478498fe745bc2f9";
const AUDITOR =
  process.argv[3] ?? "0x9e979fc17f9c589d9ef8c23d8cf5dd28b6e60e3a8fb67ac7a7dbf965bc76253b";

function loadOwner(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  const f = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(f.exportedPrivateKey as string);
}

async function accessIdFor(sui: ReturnType<typeof getSuiClient>, mandateId: string): Promise<string> {
  const res = await sui.queryEvents({
    query: { MoveEventType: `${PACKAGE_ID}::record::AccessCreated` },
    order: "descending",
    limit: 50,
  });
  const ev = res.data.find((e) => String((e.parsedJson as Record<string, unknown>).mandate_id) === mandateId);
  if (!ev) throw new Error(`no access object for ${mandateId}`);
  return String((ev.parsedJson as Record<string, unknown>).access_id);
}

async function capIdFor(sui: ReturnType<typeof getSuiClient>, owner: string, mandateId: string): Promise<string> {
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

  const accessId = await accessIdFor(sui, MANDATE);
  const capId = await capIdFor(sui, ownerAddr, MANDATE);
  console.log(`owner:    ${ownerAddr}`);
  console.log(`mandate:  ${MANDATE}`);
  console.log(`auditor:  ${AUDITOR}\n`);

  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::record::add_auditor`,
    arguments: [tx.object(accessId), tx.object(capId), tx.pure.address(AUDITOR)],
  });
  const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: owner, options: { showEffects: true } });
  console.log(`granted. the auditor can now verify this mandate. tx ${res.digest}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
