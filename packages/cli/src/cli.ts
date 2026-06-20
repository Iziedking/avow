#!/usr/bin/env node
// The Avow CLI.
//
// Set a mandate, anchor an agent's actions as verifiable evidence, and verify any record,
// from the terminal. Built on avow-sdk.
//
//   avow create-mandate --agent 0x.. --per-move 1000000 --daily 10000000
//   avow anchor --mandate 0x.. --access 0x.. --action payment --target stripe --amount 1500 --rationale "paid invoice"
//   avow grant --mandate 0x.. --auditor 0x..
//   avow verify --mandate 0x..
//   avow records --mandate 0x..
//
// Auth: set AVOW_KEY to a Sui private key (suiprivkey1...) or pass --key.
// Network: AVOW_NETWORK (testnet default), AVOW_PACKAGE_ID to override the package.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  getSuiClient,
  getSealClient,
  getWalrusClient,
  createMandate,
  anchor,
  verify,
  createSession,
  listRecords,
  EVIDENCE_VERSION,
  NETWORK,
  PACKAGE_ID,
  type EvidenceBundle,
} from "avow-sdk";

const HELP = `avow: proof, not trust

Usage: avow <command> [options]

Commands:
  create-mandate   Set what an agent may do and stand up its evidence access
  anchor           Anchor an agent action as verifiable evidence
  grant            Authorize an auditor wallet to read and verify this mandate
  verify           Decrypt and verify a mandate's anchored records
  records          List a mandate's anchored records (read-only, no key needed)
  help             Show this help

Auth:    AVOW_KEY=suiprivkey1...   (or --key)
Network: AVOW_NETWORK=testnet      AVOW_PACKAGE_ID=0x... to override the package

Examples:
  avow create-mandate --agent 0xAGENT --per-move 1000000 --daily 10000000
  avow anchor --mandate 0xM --access 0xA --action payment --target stripe --amount 1500 --rationale "paid invoice"
  avow grant --mandate 0xM --auditor 0xAUDITOR
  avow verify --mandate 0xM
  avow records --mandate 0xM
`;

function parseCliArgs() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        key: { type: "string" },
        agent: { type: "string" },
        "per-move": { type: "string" },
        daily: { type: "string" },
        expiry: { type: "string" },
        restrict: { type: "boolean" },
        mandate: { type: "string" },
        access: { type: "string" },
        auditor: { type: "string" },
        action: { type: "string" },
        target: { type: "string" },
        amount: { type: "string" },
        rationale: { type: "string" },
        digest: { type: "string", multiple: true },
        bundle: { type: "string" },
        limit: { type: "string" },
      },
    });
  } catch (e) {
    // The most common cause is an empty value, for example --mandate with an unset shell
    // variable. Say so instead of dumping a parser stack trace.
    console.error(`error: ${e instanceof Error ? e.message : e}`);
    console.error('A flag is probably missing its value (an unset variable?). Run "avow help".');
    process.exit(1);
  }
}

const { values, positionals } = parseCliArgs();

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function keypair(): Ed25519Keypair {
  const secret = values.key ?? process.env.AVOW_KEY;
  if (!secret) fail("set AVOW_KEY to a Sui private key (suiprivkey1...) or pass --key");
  return Ed25519Keypair.fromSecretKey(secret as string);
}

function need(name: "mandate" | "access"): string {
  const v = values[name];
  if (!v) fail(`--${name} is required`);
  return v as string;
}

function suiscan(digest: string): string {
  return `https://suiscan.xyz/${NETWORK}/tx/${digest}`;
}

async function cmdCreateMandate() {
  const signer = keypair();
  const sui = getSuiClient();
  const agent = values.agent ?? signer.getPublicKey().toSuiAddress();
  const created = await createMandate(sui, signer, {
    agent,
    perMoveCap: BigInt(values["per-move"] ?? "1000000000"),
    dailyCap: BigInt(values.daily ?? "10000000000"),
    expiryEpoch: BigInt(values.expiry ?? "100000"),
    restrictTargets: Boolean(values.restrict),
  });
  console.log(`network: ${NETWORK}`);
  console.log(`agent:   ${agent}`);
  console.log("");
  console.log(`AVOW_MANDATE_ID=${created.mandateId}`);
  console.log(`AVOW_ACCESS_ID=${created.accessId}`);
  console.log(`# admin cap, keep it safe: ${created.capId}`);
}

async function cmdAnchor() {
  const signer = keypair();
  const mandateId = need("mandate");
  const accessId = need("access");
  const sui = getSuiClient();

  let bundle: EvidenceBundle;
  if (values.bundle) {
    bundle = JSON.parse(readFileSync(values.bundle, "utf8")) as EvidenceBundle;
  } else {
    bundle = {
      version: EVIDENCE_VERSION,
      mandateId,
      agent: signer.getPublicKey().toSuiAddress(),
      actionType: values.action ?? "action",
      target: values.target ?? "",
      amount: values.amount ?? "0",
      rationale: values.rationale ?? "",
      observed: {},
      before: {},
      after: {},
      txDigests: values.digest ?? [],
      timestampMs: Date.now(),
    };
  }

  const proof = await anchor({
    suiClient: sui,
    sealClient: getSealClient(sui),
    walrusClient: getWalrusClient(sui),
    signer,
    mandateId,
    accessId,
    bundle,
  });
  console.log("anchored.");
  console.log(`  blob:  ${proof.blobId}`);
  console.log(`  hash:  ${proof.evidenceHashHex}`);
  console.log(`  proof: ${suiscan(proof.anchorDigest)}`);
}

// The evidence access for a mandate, found from its AccessCreated event. Pass --access to skip.
async function accessIdFor(sui: ReturnType<typeof getSuiClient>, mandateId: string): Promise<string> {
  const res = await sui.queryEvents({
    query: { MoveEventType: `${PACKAGE_ID}::record::AccessCreated` },
    order: "descending",
    limit: 50,
  });
  const ev = res.data.find((e) => String((e.parsedJson as Record<string, unknown>).mandate_id) === mandateId);
  if (!ev) fail(`no evidence access found for mandate ${mandateId}`);
  return String((ev.parsedJson as Record<string, unknown>).access_id);
}

// The MandateCap this key holds for a mandate — the authority to grant. Only the owner who created
// the mandate holds it.
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
  fail(`this key holds no MandateCap for ${mandateId} — only the owner who created the mandate can grant`);
}

async function cmdGrant() {
  const signer = keypair();
  const mandateId = need("mandate");
  const auditor = values.auditor;
  if (!auditor) fail("--auditor is required (the wallet to authorize)");
  const sui = getSuiClient();
  const owner = signer.getPublicKey().toSuiAddress();

  // Find the access (auto, or --access) and the cap this key holds, then authorize the auditor.
  const accessId = values.access ?? (await accessIdFor(sui, mandateId));
  const capId = await capIdFor(sui, owner, mandateId);

  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::record::add_auditor`,
    arguments: [tx.object(accessId), tx.object(capId), tx.pure.address(auditor)],
  });
  const res = await sui.signAndExecuteTransaction({ transaction: tx, signer, options: { showEffects: true } });
  if (res.effects?.status?.status !== "success") fail(res.effects?.status?.error ?? "grant failed");
  console.log(`granted. ${auditor}`);
  console.log(`can now decrypt and verify this mandate's records with their own wallet.`);
  console.log(`  proof: ${suiscan(res.digest)}`);
}

async function cmdRecords() {
  const mandateId = need("mandate");
  const sui = getSuiClient();
  const records = await listRecords(sui, mandateId, Number(values.limit ?? "50"));
  if (records.length === 0) {
    console.log("no anchored records for this mandate.");
    return;
  }
  for (const r of records) {
    console.log(`${r.actionType}  -> ${r.target}  ${r.amount}  ${suiscan(r.txDigest ?? "")}`);
  }
}

async function cmdVerify() {
  const signer = keypair();
  const mandateId = need("mandate");
  const sui = getSuiClient();
  const records = await listRecords(sui, mandateId, Number(values.limit ?? "50"));
  if (records.length === 0) {
    console.log("no anchored records for this mandate.");
    return;
  }
  const seal = getSealClient(sui);
  const walrus = getWalrusClient(sui);
  const session = await createSession(sui, signer);

  let ok = 0;
  for (const r of records) {
    try {
      const result = await verify({
        suiClient: sui,
        sealClient: seal,
        walrusClient: walrus,
        sessionKey: session,
        record: r,
      });
      const pass = result.hashMatches && result.amountMatches && result.withinMandate;
      if (pass) ok++;
      console.log(
        `${pass ? "ok  " : "FAIL"}  ${r.actionType} -> ${r.target} ${r.amount}` +
          (pass ? `  "${result.bundle.rationale}"` : ""),
      );
    } catch (e) {
      console.log(`FAIL  ${r.actionType} -> ${r.target} ${r.amount}  (${e instanceof Error ? e.message : e})`);
    }
  }
  console.log(`\n${ok}/${records.length} verified.`);
}

async function main() {
  const command = positionals[0];
  switch (command) {
    case "create-mandate":
      return cmdCreateMandate();
    case "anchor":
      return cmdAnchor();
    case "grant":
      return cmdGrant();
    case "verify":
      return cmdVerify();
    case "records":
      return cmdRecords();
    case "help":
    case undefined:
      console.log(HELP);
      return;
    default:
      fail(`unknown command "${command}". Run "avow help".`);
  }
}

main().catch((e) => {
  console.error("error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
