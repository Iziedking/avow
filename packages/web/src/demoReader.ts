// The demo reader: a read-only key pre-granted as an auditor on the demo agents, so anyone can
// verify them without owning them. Used only to sign the Seal session when inspecting a demo.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { DEMO_READER_KEY, DEMO_AGENTS } from "./config";

const reader = Ed25519Keypair.fromSecretKey(DEMO_READER_KEY);

export const demoReaderAddress = reader.getPublicKey().toSuiAddress();

export async function demoReaderSign(input: {
  message: Uint8Array;
}): Promise<{ signature: string }> {
  const { signature } = await reader.signPersonalMessage(input.message);
  return { signature };
}

export function isDemoMandate(mandateId: string): boolean {
  return DEMO_AGENTS.some((a) => a.mandateId === mandateId);
}
