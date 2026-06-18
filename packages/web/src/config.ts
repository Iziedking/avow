// Where the dashboard reads from. Testnet for now; these move to mainnet when the package
// does. Mirrors deployments/testnet.json.

export const NETWORK = "testnet" as const;

export const PACKAGE_ID =
  "0x635babba8ed8ff326830ac22b77d6e3a541824926292135e8d68248760a5ff6e";

// The reference agent's mandate, shown by default. A live risk-aware run: six cycles, four
// moves anchored, and every cycle it provably ignored a higher-yield pool for being too risky.
// All independently verified.
export const DEMO_MANDATE_ID =
  "0x1d6d7892132773b525278fd714b2acbfa96fff762ae0a0c3b97bd094b89568db";

export const SUISCAN = `https://suiscan.xyz/${NETWORK}`;
export const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

// Writing evidence from the browser: the same upload relay and storage window the SDK uses.
export const WALRUS_UPLOAD_RELAY = "https://upload-relay.testnet.walrus.space";
export const WALRUS_TIP_MAX_MIST = 1_000_000;
export const WALRUS_EPOCHS = 5;
export const EVIDENCE_VERSION = 1;

// Seal open-mode key servers (Mysten testnet), threshold 2. Same set the SDK uses, declared
// here so the browser builds a Seal client without pulling the node-side SDK into the bundle.
export const SEAL_KEY_SERVERS: { objectId: string; weight: number }[] = [
  { objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", weight: 1 },
  { objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", weight: 1 },
];
export const SEAL_THRESHOLD = 2;
