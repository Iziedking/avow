// The demo reader: a read-only key pre-granted as an auditor on the demo agents, so anyone can
// verify them without owning them. Used only to sign the Seal session when inspecting a demo.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { DEMO_READER_KEY, DEMO_AGENTS, DEMO_USERS } from "./config";

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

/** A demo identity you can "view as": its own address and a signer backed by its own key. The
 *  owner (demo reader) decrypts everything; each user decrypts only their own records. */
export interface DemoIdentity {
  name: string;
  address: string;
  sign: (input: { message: Uint8Array }) => Promise<{ signature: string }>;
}

export const demoUsers: DemoIdentity[] = DEMO_USERS.map((u) => {
  const kp = Ed25519Keypair.fromSecretKey(u.key);
  return {
    name: u.name,
    address: kp.getPublicKey().toSuiAddress(),
    sign: async ({ message }) => {
      const { signature } = await kp.signPersonalMessage(message);
      return { signature };
    },
  };
});

/** Owner view (sees every user) plus one entry per demo user. */
export const demoIdentities: DemoIdentity[] = [
  { name: "Owner", address: demoReaderAddress, sign: demoReaderSign },
  ...demoUsers,
];
