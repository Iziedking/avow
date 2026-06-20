// Network, endpoints, and ids the Avow SDK needs.
//
// Every value here was verified against the installed SDK type definitions and the live
// Seal docs on 2026-06-16. Do not change a key server id or an endpoint without checking
// the source again.

export type AvowNetwork = "testnet" | "mainnet";

// Read an env override if we are in a Node-like runtime. Guarded so the SDK also runs in a
// browser (the verification dashboard), where `process` does not exist.
function env(key: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[key] : undefined;
}

export const NETWORK: AvowNetwork = (env("AVOW_NETWORK") as AvowNetwork | undefined) ?? "testnet";

// The published avow package. Source of truth is deployments/testnet.json; override with the
// AVOW_PACKAGE_ID env var when pointing at a different deployment.
export const PACKAGE_ID =
  env("AVOW_PACKAGE_ID") ??
  "0x4f3e25d7858a70ce4f1a437a3f91f24700407f52c68bb93775522d752841a3ee";

// After a package upgrade, struct and event TYPES stay anchored to the package id that first
// defined them, so type/event queries (MoveEventType, owned-object StructType filters) must use
// this original id while moveCalls use the latest PACKAGE_ID. Identical on first publish; set
// once and never change across upgrades. Override with AVOW_ORIGINAL_PACKAGE_ID if needed.
export const ORIGINAL_PACKAGE_ID = env("AVOW_ORIGINAL_PACKAGE_ID") ?? PACKAGE_ID;

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
export const WALRUS_EPOCHS = Number(env("AVOW_WALRUS_EPOCHS")) || 5;

// Writes go through Mysten's upload relay rather than fanning out to many storage nodes
// directly, which is far more reliable from a single machine. Source: Walrus network
// reference, upload relays. sendTip caps what we pay the relay, in MIST.
export const WALRUS_UPLOAD_RELAY =
  NETWORK === "mainnet"
    ? "https://upload-relay.mainnet.walrus.space"
    : "https://upload-relay.testnet.walrus.space";

export const WALRUS_TIP_MAX_MIST = 1_000_000;

// Unit conversions.
export const MIST_PER_SUI = 1_000_000_000n;
export const FROST_PER_WAL = 1_000_000_000n;
