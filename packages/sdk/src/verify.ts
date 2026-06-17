// verify(): independently confirm an anchored record is real and within authority.
//
// The flow: fetch the sealed bundle from Walrus, decrypt it through Seal (the key servers
// dry-run record::seal_approve against the reader's session), recompute the SHA-256, and
// compare it to the on-chain anchor. Then read the mandate straight from chain and confirm
// the action sits inside its limits. Nothing here trusts the agent; it checks.

import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toHex } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";
import { EncryptedObject, SessionKey } from "@mysten/seal";
import type { SealClient } from "@mysten/seal";
import type { WalrusClient } from "@mysten/walrus";
import { PACKAGE_ID } from "./config";
import { encodeBundle, sha256 } from "./hash";
import type { AnchoredRecord, EvidenceBundle, VerifyResult } from "./types";

/**
 * Build a Seal session key signed by a signer that holds its key locally, for example in a
 * CLI or an agent. In a browser, build the SessionKey and sign its personal message with the
 * connected wallet instead.
 */
export async function createSession(
  suiClient: SuiJsonRpcClient,
  signer: Signer,
  ttlMin = 10,
): Promise<SessionKey> {
  const session = await SessionKey.create({
    address: signer.toSuiAddress(),
    packageId: PACKAGE_ID,
    ttlMin,
    suiClient,
  });
  const { signature } = await signer.signPersonalMessage(session.getPersonalMessage());
  await session.setPersonalMessageSignature(signature);
  return session;
}

const READ_RETRIES = 5;
const READ_BACKOFF_MS = 1500;

export interface VerifyOptions {
  suiClient: SuiJsonRpcClient;
  sealClient: SealClient;
  walrusClient: WalrusClient;
  /** A session key for a reader of this evidence access (the principal or an auditor). */
  sessionKey: SessionKey;
  record: AnchoredRecord;
}

export async function verify(opts: VerifyOptions): Promise<VerifyResult> {
  const { suiClient, sealClient, walrusClient, sessionKey, record } = opts;

  // 1. Fetch the sealed bundle. Read-after-write can briefly 404, so retry with backoff.
  const encrypted = await readBlobWithRetry(walrusClient, record.blobId);

  // 2. Recover the key id from the ciphertext and build the seal_approve transaction the
  //    key servers dry-run, then decrypt.
  const id = EncryptedObject.parse(encrypted).id;
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::record::seal_approve`,
    arguments: [tx.pure.vector("u8", fromHex(id)), tx.object(record.accessId)],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  const plaintext = await sealClient.decrypt({ data: encrypted, sessionKey, txBytes });

  // 3. Recompute the hash and compare to the on-chain anchor.
  const hashMatches = toHex(await sha256(plaintext)) === stripHexPrefix(record.evidenceHashHex);

  const bundle = JSON.parse(new TextDecoder().decode(plaintext)) as EvidenceBundle;
  const amountMatches = bundle.amount === record.amount;

  // 4. Read the mandate from chain and confirm the action sits inside its limits.
  const withinMandate = await checkWithinMandate(suiClient, record);

  return { hashMatches, amountMatches, withinMandate, bundle };
}

/**
 * Re-encode a bundle and hash it. Useful for a caller that already holds the plaintext and
 * wants the hash without a round trip.
 */
export async function hashBundle(bundle: EvidenceBundle): Promise<string> {
  return toHex(await sha256(encodeBundle(bundle)));
}

async function checkWithinMandate(
  suiClient: SuiJsonRpcClient,
  record: AnchoredRecord,
): Promise<boolean> {
  const obj = await suiClient.getObject({
    id: record.mandateId,
    options: { showContent: true },
  });
  const content = obj.data?.content;
  if (!content || content.dataType !== "moveObject") {
    return false;
  }
  const fields = content.fields as Record<string, unknown>;
  const perMoveCap = BigInt(String(fields.per_move_cap));
  const revoked = Boolean(fields.revoked);
  const amount = BigInt(record.amount);
  return !revoked && amount <= perMoveCap;
}

async function readBlobWithRetry(
  walrusClient: WalrusClient,
  blobId: string,
): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < READ_RETRIES; attempt++) {
    try {
      return await walrusClient.readBlob({ blobId });
    } catch (err) {
      lastError = err;
      await sleep(READ_BACKOFF_MS * (attempt + 1));
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}
