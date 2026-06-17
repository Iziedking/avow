// Where the dashboard reads from. Testnet for now; these move to mainnet when the package
// does. Mirrors deployments/testnet.json.

export const NETWORK = "testnet" as const;

export const PACKAGE_ID =
  "0x635babba8ed8ff326830ac22b77d6e3a541824926292135e8d68248760a5ff6e";

// The reference agent's mandate, shown by default.
export const DEMO_MANDATE_ID =
  "0x0f893eb746e08ae348d1389f3c633b282966218e784e8f142bf0acaa60184c11";

export const SUISCAN = `https://suiscan.xyz/${NETWORK}`;
export const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

// Seal open-mode key servers (Mysten testnet), threshold 2. Same set the SDK uses, declared
// here so the browser builds a Seal client without pulling the node-side SDK into the bundle.
export const SEAL_KEY_SERVERS: { objectId: string; weight: number }[] = [
  { objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", weight: 1 },
  { objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", weight: 1 },
];
export const SEAL_THRESHOLD = 2;
