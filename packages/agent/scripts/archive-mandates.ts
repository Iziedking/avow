// Clean the slate for a live demo. On-chain mandates can't be deleted (they're shared objects that
// persist), but the dashboard and dev console list mandates by which MandateCaps your wallet owns.
// So this transfers the platform's existing caps to a fresh archive wallet, which removes those
// mandates from "your agents". After this, only mandates created from here on (demo, claims) show.
//
// Keep some by passing their mandate ids as args (e.g. the curated bill-payer demo):
//   npx tsx packages/agent/scripts/archive-mandates.ts 0xKEEP1 0xKEEP2
//
// The archive wallet's key is printed, so it's recoverable: send the caps back to the platform to
// restore admin control. Nothing is burned.

import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, PACKAGE_ID } from "avow-sdk";

function loadPlatform(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  const f = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(f.exportedPrivateKey as string);
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const keep = new Set(args.filter((s) => s.startsWith("0x")).map((s) => s.toLowerCase()));
  const platform = loadPlatform();
  const platformAddr = platform.getPublicKey().toSuiAddress();
  const sui = getSuiClient();

  // The archive wallet that will hold the old caps. Recoverable via the printed key.
  const archive = new Ed25519Keypair();
  const archiveAddr = archive.getPublicKey().toSuiAddress();

  // Gather every MandateCap the platform owns (paged).
  const caps: { capId: string; mandateId: string }[] = [];
  let cursor: string | null | undefined = null;
  for (let page = 0; page < 20; page++) {
    const res = await sui.getOwnedObjects({
      owner: platformAddr,
      filter: { StructType: `${PACKAGE_ID}::mandate::MandateCap` },
      options: { showContent: true },
      cursor,
    });
    for (const o of res.data) {
      const f = (o.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
      const mandateId = f && String(f.mandate_id);
      if (mandateId && o.data?.objectId) caps.push({ capId: o.data.objectId, mandateId });
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }

  const toArchive = caps.filter((c) => !keep.has(c.mandateId.toLowerCase()));
  console.log(`platform:  ${platformAddr}`);
  console.log(`caps owned: ${caps.length}   keeping: ${caps.length - toArchive.length}   archiving: ${toArchive.length}\n`);
  if (keep.size) console.log(`keep list: ${[...keep].map((k) => k.slice(0, 12)).join(", ")}\n`);

  if (!toArchive.length) {
    console.log("nothing to archive. the platform's mandate list is already clean.");
    return;
  }

  if (dry) {
    console.log("--dry: would archive these mandates (nothing moved):");
    toArchive.forEach((c, i) => console.log(`  [${i + 1}] ${c.mandateId}`));
    console.log(`\nrun again without --dry to archive them.`);
    return;
  }

  console.log(`archive wallet: ${archiveAddr}`);
  console.log(`archive key:    ${archive.getSecretKey()}   (keep this to recover)\n`);

  // Transfer the caps in batches so one big tx doesn't exceed limits.
  const BATCH = 200;
  for (let i = 0; i < toArchive.length; i += BATCH) {
    const slice = toArchive.slice(i, i + BATCH);
    const tx = new Transaction();
    tx.transferObjects(slice.map((c) => tx.object(c.capId)), archiveAddr);
    const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: platform, options: { showEffects: true } });
    if (res.effects?.status?.status !== "success") throw new Error(res.effects?.status?.error ?? "transfer failed");
    console.log(`archived ${slice.length}  ·  tx ${res.digest}`);
  }

  console.log(`\ndone. those mandates no longer show in the dashboard or dev console for the platform wallet.`);
  console.log(`only mandates created from now on (demo, claims) will appear.`);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
