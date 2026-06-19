// One-shot: swap testnet SUI -> WAL for any wallet, securely.
//
// It prompts for your private key WITHOUT echoing it (the key is never shown, logged, or written
// to disk; it lives only in memory for the one transaction). Then it swaps SUI for WAL on the
// Walrus testnet exchange and the WAL lands in your wallet (or a recipient you name).
//
//   npx tsx packages/agent/scripts/get-wal.ts <amountSUI> [recipient]
//   # e.g.  npx tsx packages/agent/scripts/get-wal.ts 2
//   # you can also pass the key non-interactively via AVOW_KEY=... (it is never printed)

import { createInterface } from "node:readline";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient } from "avow-sdk";

// Walrus testnet SUI<->WAL exchange (what `walrus get-wal` uses under the hood).
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

const fmt = (raw: string) => (Number(raw) / 1e9).toFixed(3);

async function main() {
  const amountSui = Math.max(0.1, Number(process.argv[2] ?? "1"));
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
  const recipient = process.argv[3] && process.argv[3].startsWith("0x") ? process.argv[3] : addr;

  console.log(`wallet:     ${addr}`);
  console.log(`recipient:  ${recipient}`);
  const before = await sui.getBalance({ owner: recipient, coinType: WAL_TYPE });
  console.log(`WAL before: ${fmt(before.totalBalance)}`);

  const tx = new Transaction();
  const [pay] = tx.splitCoins(tx.gas, [Math.round(amountSui * 1e9)]);
  const wal = tx.moveCall({
    target: `${EXCHANGE_PKG}::wal_exchange::exchange_all_for_wal`,
    arguments: [tx.object(EXCHANGE_ID), pay],
  });
  tx.transferObjects([wal], recipient);

  console.log(`swapping ${amountSui} SUI -> WAL…`);
  const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: kp, options: { showEffects: true } });
  if (res.effects?.status?.status !== "success") {
    console.error("swap failed:", JSON.stringify(res.effects?.status));
    process.exit(1);
  }

  // Let the balance settle, then report.
  await sui.waitForTransaction({ digest: res.digest });
  const after = await sui.getBalance({ owner: recipient, coinType: WAL_TYPE });
  console.log(`done. tx ${res.digest}`);
  console.log(`WAL after:  ${fmt(after.totalBalance)}  (+${(Number(after.totalBalance) - Number(before.totalBalance)) / 1e9})`);
}

main().catch((e) => {
  console.error("FAIL:", (e as Error).message);
  process.exit(1);
});
