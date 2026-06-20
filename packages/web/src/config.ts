// Where the dashboard reads from. Testnet for now; these move to mainnet when the package
// does. Mirrors deployments/testnet.json.

export const NETWORK = "testnet" as const;

export const PACKAGE_ID =
  "0x4f3e25d7858a70ce4f1a437a3f91f24700407f52c68bb93775522d752841a3ee";

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
      "One shared agent paying the bills of two consumers. Watch its full reasoning for each decision, how it seals each consumer's records so they only see their own, and one action it got wrong, paid over the limit, captured and flagged out of bounds on chain.",
    mandateId: "0xed07c664a788e3912570d4e268fb4c8e04cdebb01fb020b5a4dff1ace2654b25",
  },
];

// Shown by default: the consumer bill payer.
export const DEMO_MANDATE_ID = DEMO_AGENTS[0].mandateId;

// A read-only key, pre-granted as an auditor on the demo agents above, so anyone can verify them
// on the dashboard without owning them or connecting a wallet. As a global reader it can decrypt
// every user's evidence on the demo agent, the "owner" view. It holds no funds and cannot
// anchor, grant, or sign anything else.
export const DEMO_READER_KEY =
  "suiprivkey1qqant7wdkk409ygmzhu7uw77pyact9npp76ql0ee5tlcrk9rkr62y3rwwvw";

// The demo consumers of the shared bill payer. Each key decrypts ONLY that user's own records
// (Seal's account-based policy), so the dashboard can let you "view as" each one and see that
// the per-user isolation is real, not cosmetic. These are throwaway demo keys.
export interface DemoUser {
  name: string;
  address: string;
  key: string;
}

export const DEMO_USERS: DemoUser[] = [
  {
    name: "Alice",
    address: "0xc5ae450191e8e59ce6afb2b7fbb7a90b9cb730068ed9520383b58b92139710fa",
    key: "suiprivkey1qqzkftwu65htj4wdhse6l3ej6vm6lmd5awvhchg88q56pnxxxghh5aqeac2",
  },
  {
    name: "Bob",
    address: "0x2b53a1f870e777faa1df9a998cf006a7c09c599499bc8899630f3375c08611cd",
    key: "suiprivkey1qray77c6fu2z3n73uxugm9kgtu89yjk6y0g4ye60dstpzwjznccdqslgsmf",
  },
];

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
