// Network, endpoints, and ids the Avow SDK needs.
//
// Every value here was verified against the installed SDK type definitions and the live
// Seal docs on 2026-06-16. Do not change a key server id or an endpoint without checking
// the source again.

export type AvowNetwork = "testnet" | "mainnet";

export const NETWORK: AvowNetwork =
  (process.env.AVOW_NETWORK as AvowNetwork | undefined) ?? "testnet";

// The published avow package. Source of truth is deployments/testnet.json; override with the
// AVOW_PACKAGE_ID env var when pointing at a different deployment.
export const PACKAGE_ID =
  process.env.AVOW_PACKAGE_ID ??
  "0x635babba8ed8ff326830ac22b77d6e3a541824926292135e8d68248760a5ff6e";

// Seal open-mode key servers run by Mysten on testnet. Open mode lets any package request
// keys, which is what we want while building. Source: seal-docs.wal.app Pricing, verified
// key servers. Threshold 2 means both servers must return a share to decrypt.
export interface KeyServer {
  objectId: string;
  weight: number;
}

export const SEAL_KEY_SERVERS: KeyServer[] = [
  {
    objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    weight: 1,
  },
  {
    objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
    weight: 1,
  },
];

export const SEAL_THRESHOLD = 2;

// How long evidence blobs are stored on Walrus, in epochs. A testnet epoch is about a day.
export const WALRUS_EPOCHS = 5;

// Unit conversions.
export const MIST_PER_SUI = 1_000_000_000n;
export const FROST_PER_WAL = 1_000_000_000n;
