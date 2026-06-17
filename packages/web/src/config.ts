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
