// Where the dashboard reads from. Testnet for now; these move to mainnet when the package
// does. Mirrors deployments/testnet.json.

export const NETWORK = "testnet" as const;

export const PACKAGE_ID =
  "0x635babba8ed8ff326830ac22b77d6e3a541824926292135e8d68248760a5ff6e";

// After a package upgrade, struct and event TYPES stay anchored to the package id that first
// defined them. So type/event QUERIES (owned-object StructType filters, MoveEventType queries)
// must use this original id, while moveCalls use the latest PACKAGE_ID above. On first publish
// they are identical; set this once and never change it across upgrades.
// NOTE: Seal's encryption namespace is also anchored to the package id used at encrypt time.
// Before the first mainnet upgrade, revisit the Seal packageId in verify.ts/anchorLive.ts
// against the Seal upgrade docs (it likely needs to pin to this original id too).
export const ORIGINAL_PACKAGE_ID = PACKAGE_ID;

// Two reference agents to inspect, both live on testnet with every decision recorded and
// independently verified. The consumer bill payer is shown first.
export interface DemoAgent {
  name: string;
  blurb: string;
  mandateId: string;
}

export const DEMO_AGENTS: DemoAgent[] = [
  {
    name: "Bill payer",
    blurb:
      "Pays your bills automatically, and provably refuses overcharges, unknown billers, and anything over your limit.",
    mandateId: "0x745492d3c02d9095a81744a30024b72a27c5566229fa5db2fef672352012480f",
  },
  {
    name: "Yield router",
    blurb:
      "Routes funds to the best risk-adjusted yield, and provably ignores pools that are too risky.",
    mandateId: "0x1d6d7892132773b525278fd714b2acbfa96fff762ae0a0c3b97bd094b89568db",
  },
];

// Shown by default: the consumer bill payer.
export const DEMO_MANDATE_ID = DEMO_AGENTS[0].mandateId;

// A read-only key, pre-granted as an auditor on the demo agents above, so anyone can verify them
// on the dashboard without owning them or connecting a wallet. It can ONLY decrypt the demo
// agents' sealed evidence, it holds no funds and cannot anchor, grant, or sign anything else.
export const DEMO_READER_KEY =
  "suiprivkey1qqfmvq2cdp242jnrvqr0hutlzkr5lrhvxlny3g7vxmt9wuw4lcjqs7m46s3";

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
