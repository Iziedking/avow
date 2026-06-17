// Verify an anchored record in the browser, the way an auditor would.
//
// Fetch the sealed evidence from Walrus, ask Seal for a decryption key (the key servers
// dry-run record::seal_approve against the connected reader's signed session), decrypt,
// recompute the SHA-256, and compare it to the hash that was anchored on chain. If it
// matches, the evidence is genuine and unaltered. Nothing here trusts the agent.

import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toHex } from "@mysten/sui/utils";
import { SealClient, SessionKey, EncryptedObject } from "@mysten/seal";
import { suiClient, type AnchoredRecord } from "./records";
import { PACKAGE_ID, SEAL_KEY_SERVERS, WALRUS_AGGREGATOR } from "./config";

export interface VerifyOutcome {
  hashMatches: boolean;
  recomputedHashHex: string;
  rationale: string;
  bundle: Record<string, unknown>;
}

// A signing function shaped like dapp-kit's useSignPersonalMessage mutateAsync.
export type SignPersonalMessage = (input: {
  message: Uint8Array;
}) => Promise<{ signature: string }>;

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return toHex(new Uint8Array(digest));
}

async function fetchBlob(blobId: string): Promise<Uint8Array> {
  const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`Walrus read failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function verifyRecord(
  record: AnchoredRecord,
  readerAddress: string,
  signPersonalMessage: SignPersonalMessage,
): Promise<VerifyOutcome> {
  const client = suiClient();
  const ciphertext = await fetchBlob(record.blobId);

  // Prove to the key servers that this reader may decrypt, by signing a short-lived session.
  const sessionKey = await SessionKey.create({
    address: readerAddress,
    packageId: PACKAGE_ID,
    ttlMin: 10,
    suiClient: client,
  });
  const { signature } = await signPersonalMessage({ message: sessionKey.getPersonalMessage() });
  await sessionKey.setPersonalMessageSignature(signature);

  // The transaction the key servers dry-run. Its key id comes from the ciphertext itself.
  const id = EncryptedObject.parse(ciphertext).id;
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::record::seal_approve`,
    arguments: [tx.pure.vector("u8", fromHex(id)), tx.object(record.accessId)],
  });
  const txBytes = await tx.build({ client, onlyTransactionKind: true });

  const seal = new SealClient({
    suiClient: client,
    serverConfigs: SEAL_KEY_SERVERS,
    verifyKeyServers: false,
  });
  const plaintext = await seal.decrypt({ data: ciphertext, sessionKey, txBytes });

  const recomputedHashHex = await sha256Hex(plaintext);
  const bundle = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;

  return {
    hashMatches: recomputedHashHex === record.evidenceHashHex,
    recomputedHashHex,
    rationale: typeof bundle.rationale === "string" ? bundle.rationale : "",
    bundle,
  };
}
