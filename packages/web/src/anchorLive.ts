// Create one real proof from the browser, signed by the connected wallet acting as the agent.
//
// The same flow the SDK runs, but every transaction is signed by the wallet instead of a
// keypair: Seal-encrypt the evidence, write it to Walrus through the upload relay (a register
// transaction, an upload to the relay, then a certify transaction), and call record::anchor.
// Three wallet approvals in all. The connected wallet must be the agent named in the mandate,
// and it needs a little SUI for gas and WAL for storage.

import { Transaction } from "@mysten/sui/transactions";
import { fromHex, toHex } from "@mysten/sui/utils";
import { SealClient } from "@mysten/seal";
import { WalrusClient } from "@mysten/walrus";
import walrusWasmUrl from "@mysten/walrus-wasm/web/walrus_wasm_bg.wasm?url";
import { suiClient } from "./records";
import {
  PACKAGE_ID,
  SEAL_KEY_SERVERS,
  SEAL_THRESHOLD,
  WALRUS_UPLOAD_RELAY,
  WALRUS_TIP_MAX_MIST,
  WALRUS_EPOCHS,
  EVIDENCE_VERSION,
  NETWORK,
} from "./config";

// Shaped like dapp-kit's useSignAndExecuteTransaction mutateAsync.
export type SignAndExecute = (input: {
  transaction: Transaction;
}) => Promise<{ digest: string }>;

export interface LiveAction {
  agent: string;
  actionType: string;
  target: string;
  amount: string;
  rationale: string;
  observed: unknown;
}

export interface LiveAnchorResult {
  blobId: string;
  evidenceHashHex: string;
  anchorDigest: string;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return new Uint8Array(d);
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

export async function anchorLive(opts: {
  address: string;
  mandateId: string;
  accessId: string;
  action: LiveAction;
  signAndExecute: SignAndExecute;
  onStep?: (msg: string) => void;
}): Promise<LiveAnchorResult> {
  const { address, mandateId, accessId, action, signAndExecute, onStep } = opts;
  const sui = suiClient();
  const step = (m: string) => onStep?.(m);

  // 1. Build the evidence bundle and hash it.
  const bundle = {
    version: EVIDENCE_VERSION,
    mandateId,
    agent: action.agent,
    actionType: action.actionType,
    target: action.target,
    amount: action.amount,
    rationale: action.rationale,
    observed: action.observed,
    before: {},
    after: {},
    txDigests: [] as string[],
    timestampMs: Date.now(),
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const hash = await sha256(plaintext);

  // 2. Seal-encrypt under a key id prefixed by the access object.
  step("sealing the evidence with Seal…");
  const seal = new SealClient({
    suiClient: sui,
    serverConfigs: SEAL_KEY_SERVERS,
    verifyKeyServers: false,
  });
  const id = toHex(concat(fromHex(accessId), randomBytes(8)));
  const { encryptedObject } = await seal.encrypt({
    threshold: SEAL_THRESHOLD,
    packageId: PACKAGE_ID,
    id,
    data: plaintext,
  });

  // 3. Store on Walrus through the relay, signing register and certify with the wallet.
  const walrus = new WalrusClient({
    network: NETWORK,
    suiClient: sui,
    wasmUrl: walrusWasmUrl,
    uploadRelay: { host: WALRUS_UPLOAD_RELAY, sendTip: { max: WALRUS_TIP_MAX_MIST } },
  });
  const flow = walrus.writeBlobFlow({ blob: encryptedObject });

  step("encoding the blob…");
  await flow.encode();

  step("registering storage on Walrus, approve in your wallet…");
  const register = await signAndExecute({
    transaction: flow.register({ epochs: WALRUS_EPOCHS, owner: address, deletable: false }),
  });

  step("uploading to Walrus…");
  await flow.upload({ digest: register.digest });

  step("certifying the blob, approve in your wallet…");
  await signAndExecute({ transaction: flow.certify() });

  const { blobId } = await flow.getBlob();

  // 4. Anchor on chain. The mandate check runs here; an out-of-bounds action would be rejected.
  step("anchoring the proof on chain, approve in your wallet…");
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::record::anchor`,
    arguments: [
      tx.object(mandateId),
      tx.object(accessId),
      tx.pure.vector("u8", new TextEncoder().encode(blobId)),
      tx.pure.vector("u8", hash),
      tx.pure.u64(BigInt(action.amount)),
      tx.pure.vector("u8", new TextEncoder().encode(action.actionType)),
      tx.pure.vector("u8", new TextEncoder().encode(action.target)),
    ],
  });
  const res = await signAndExecute({ transaction: tx });

  return { blobId, evidenceHashHex: toHex(hash), anchorDigest: res.digest };
}
