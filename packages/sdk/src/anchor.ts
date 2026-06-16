// anchor(): turn an agent action into a private, verifiable, on-chain record.
//
// The flow: hash the bundle, Seal-encrypt it under a key id whose prefix is the evidence
// access object, store the ciphertext on Walrus, then call record::anchor with the blob id,
// the hash, and the public fields. The mandate check runs inside record::anchor, so an
// out-of-bounds action never produces a record.

import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toHex } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";
import type { SealClient } from "@mysten/seal";
import type { WalrusClient } from "@mysten/walrus";
import { PACKAGE_ID, SEAL_THRESHOLD, WALRUS_EPOCHS } from "./config";
import { encodeBundle, sha256 } from "./hash";
import type { EvidenceBundle, AnchorResult } from "./types";

const NONCE_BYTES = 8;

export interface AnchorOptions {
  suiClient: SuiJsonRpcClient;
  sealClient: SealClient;
  walrusClient: WalrusClient;
  /** The agent wallet. It signs the Walrus write and the anchor transaction. */
  signer: Signer;
  mandateId: string;
  accessId: string;
  bundle: EvidenceBundle;
}

export async function anchor(opts: AnchorOptions): Promise<AnchorResult> {
  const { suiClient, sealClient, walrusClient, signer, mandateId, accessId, bundle } = opts;

  // 1. Serialize and hash the plaintext bundle.
  const plaintext = encodeBundle(bundle);
  const hash = await sha256(plaintext);

  // 2. Build the Seal key id: the access object id bytes, then a random nonce. The
  //    seal_approve policy requires the access id as the prefix.
  const nonce = randomBytes(NONCE_BYTES);
  const id = toHex(concat(fromHex(accessId), nonce));

  // 3. Encrypt to the Seal key servers.
  const { encryptedObject } = await sealClient.encrypt({
    threshold: SEAL_THRESHOLD,
    packageId: PACKAGE_ID,
    id,
    data: plaintext,
  });

  // 4. Store the ciphertext on Walrus.
  const { blobId } = await walrusClient.writeBlob({
    blob: encryptedObject,
    deletable: false,
    epochs: WALRUS_EPOCHS,
    signer,
  });

  // 5. Anchor on chain. The blob id is stored as its UTF-8 bytes.
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::record::anchor`,
    arguments: [
      tx.object(mandateId),
      tx.object(accessId),
      tx.pure.vector("u8", new TextEncoder().encode(blobId)),
      tx.pure.vector("u8", hash),
      tx.pure.u64(BigInt(bundle.amount)),
      tx.pure.vector("u8", new TextEncoder().encode(bundle.actionType)),
      tx.pure.vector("u8", new TextEncoder().encode(bundle.target)),
    ],
  });

  const res = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true },
  });

  return {
    blobId,
    evidenceHashHex: toHex(hash),
    anchorDigest: res.digest,
  };
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
