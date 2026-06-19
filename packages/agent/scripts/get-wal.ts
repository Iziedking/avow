// One-shot: swap testnet SUI <-> WAL for any wallet, securely.
//
// It prompts for your private key WITHOUT echoing it (the key is never shown, logged, or written
// to disk; it lives only in memory for the one transaction). Then it swaps on the Walrus testnet
// exchange (what `walrus get-wal` uses under the hood), and the proceeds land in your wallet (or a
// recipient you name).
//
//   npx tsx packages/agent/scripts/get-wal.ts <amount> [recipient]        # SUI -> WAL (default)
//   npx tsx packages/agent/scripts/get-wal.ts wal <amount> [recipient]    # SUI -> WAL (explicit)
//   npx tsx packages/agent/scripts/get-wal.ts sui <amount> [recipient]    # WAL -> SUI (the reverse)
//
//   # e.g.  npx tsx packages/agent/scripts/get-wal.ts 2          (2 SUI -> ~2 WAL)
//   #       npx tsx packages/agent/scripts/get-wal.ts sui 1.2    (1.2 WAL -> ~1.2 SUI)
//   # you can also pass the key non-interactively via AVOW_KEY=... (it is never printed)

import { createInterface } from "node:readline";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient } from "avow-sdk";

// Walrus testnet SUI<->WAL exchange.
const EXCHANGE_PKG = "0x82593828ed3fcb8c6a235eac9abd0adbe9c5f9bbffa9b1e7a45cdd884481ef9f";
const EXCHANGE_ID = "0xf4d164ea2def5fe07dc573992a029e010dba09b1a8dcbc44c5c2e79567f39073";
const WAL_TYPE = "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL";

// Read a secret from the terminal without echoing it back.
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(query);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Mute the echo so the key never appears on screen.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const fmt = (raw: string | bigint) => (Number(raw) / 1e9).toFixed(3);

// argv: [direction?] <amount> [recipient]. Direction is "wal" (SUI->WAL, default) or "sui" (reverse).
function parseArgs() {
  const a = process.argv.slice(2);
  let toWal = true;
  if (a[0] === "sui" || a[0] === "wal") {
    toWal = a.shift() === "wal";
  }
  const amount = Math.max(0.1, Number(a[0] ?? "1"));
  const recipient = a[1]?.startsWith("0x") ? a[1] : null;
  return { toWal, amount, recipient };
}

async function main() {
  const { toWal, amount, recipient: recipArg } = parseArgs();
  const sui = getSuiClient();

  const key = process.env.AVOW_KEY ?? (await promptHidden("paste your Sui private key (hidden): "));
  let kp: Ed25519Keypair;
  try {
    kp = Ed25519Keypair.fromSecretKey(key);
  } catch {
    console.error("that does not look like a valid Sui private key (expected suiprivkey1...).");
    process.exit(1);
  }
  const addr = kp.getPublicKey().toSuiAddress();
  const recipient = recipArg ?? addr;
  const outType = toWal ? WAL_TYPE : "0x2::sui::SUI";
  const outName = toWal ? "WAL" : "SUI";
  const inName = toWal ? "SUI" : "WAL";

  console.log(`wallet:     ${addr}`);
  console.log(`recipient:  ${recipient}`);
  const before = await sui.getBalance({ owner: recipient, coinType: outType });
  console.log(`${outName} before: ${fmt(before.totalBalance)}`);

  const tx = new Transaction();
  const want = Math.round(amount * 1e9);
  let pay;
  if (toWal) {
    // SUI -> WAL: pay from the gas coin.
    [pay] = tx.splitCoins(tx.gas, [want]);
  } else {
    // WAL -> SUI: pay from the wallet's WAL coins (merge fragments first).
    const wal = await sui.getCoins({ owner: addr, coinType: WAL_TYPE });
    if (!wal.data.length) {
      console.error("this wallet has no WAL to swap.");
      process.exit(1);
    }
    const primary = tx.object(wal.data[0].coinObjectId);
    if (wal.data.length > 1) tx.mergeCoins(primary, wal.data.slice(1).map((c) => tx.object(c.coinObjectId)));
    [pay] = tx.splitCoins(primary, [want]);
  }
  const fn = toWal ? "exchange_all_for_wal" : "exchange_all_for_sui";
  const out = tx.moveCall({ target: `${EXCHANGE_PKG}::wal_exchange::${fn}`, arguments: [tx.object(EXCHANGE_ID), pay] });
  tx.transferObjects([out], recipient);

  console.log(`swapping ${amount} ${inName} -> ${outName}…`);
  const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
  if (res.effects?.status?.status !== "success") {
    console.error("swap failed:", JSON.stringify(res.effects?.status));
    process.exit(1);
  }

  await sui.waitForTransaction({ digest: res.digest });
  const after = await sui.getBalance({ owner: recipient, coinType: outType });
  console.log(`done. tx ${res.digest}`);
  console.log(`${outName} after:  ${fmt(after.totalBalance)}  (+${(Number(after.totalBalance) - Number(before.totalBalance)) / 1e9})`);
}

main().catch((e) => {
  console.error("FAIL:", (e as Error).message);
  process.exit(1);
});
