# @avow/sdk

Avow is a trust layer for AI agents that move money on Sui. Your agent does whatever it
does. After each action, it calls `anchor()`, and Avow turns that action into a private,
tamper-proof record: the evidence is encrypted with Seal, stored on Walrus, and bound to an
on-chain anchor that the action's own mandate had to approve. Anyone you authorize can later
call `verify()` and confirm the record is real, unaltered, and within the limits you set.

The point is simple. Agents ask you to trust their numbers. Avow lets them prove them.

This SDK is two calls.

## Install

```bash
npm install @avow/sdk
```

You also need a Sui wallet for your agent and, for storing evidence, a little SUI and WAL on
the network you target. On testnet both are free.

## Anchor an action

```ts
import {
  getSuiClient,
  getSealClient,
  getWalrusClient,
  anchor,
  EVIDENCE_VERSION,
} from "@avow/sdk";

const sui = getSuiClient();
const seal = getSealClient(sui);
const walrus = getWalrusClient(sui);

const proof = await anchor({
  suiClient: sui,
  sealClient: seal,
  walrusClient: walrus,
  signer: agentKeypair,        // your agent wallet, must equal the mandate's agent
  mandateId: MANDATE_ID,       // see "Getting a mandate" below
  accessId: ACCESS_ID,
  bundle: {
    version: EVIDENCE_VERSION,
    mandateId: MANDATE_ID,
    agent: agentAddress,
    actionType: "payment",     // your label: "payment", "trade", "yield_move", anything
    target: "stripe",          // what you acted on
    amount: "1500",            // u64 as a string
    rationale: "Paid the invoice the user approved.",
    observed: { invoiceId: "inv_42" }, // any data your agent relied on, kept private
    before: {},
    after: {},
    txDigests: [actionDigest], // the on-chain digests of the real move
    timestampMs: Date.now(),
  },
});

console.log(proof.anchorDigest); // a public, verifiable record
```

Everything in `bundle` past `amount` is sealed. Only the hash, the amount, the action type,
and the target land on chain. Your strategy stays yours.

## Verify a record

```ts
import { getSuiClient, getSealClient, getWalrusClient, verify } from "@avow/sdk";
import { SessionKey } from "@mysten/seal";

const sessionKey = await SessionKey.create({
  address: readerAddress,       // the principal or an auditor you granted
  packageId: PACKAGE_ID,
  ttlMin: 10,
  suiClient: sui,
});
const { signature } = await readerKeypair.signPersonalMessage(sessionKey.getPersonalMessage());
await sessionKey.setPersonalMessageSignature(signature);

const result = await verify({
  suiClient: sui,
  sealClient: seal,
  walrusClient: walrus,
  sessionKey,
  record,                       // read from an ActionAnchored event
});

result.hashMatches;   // the evidence was not altered since it was anchored
result.amountMatches; // the bundle's amount matches the on-chain anchor
result.withinMandate; // the action sits inside the mandate's limits, checked from chain
```

`verify()` reads the blob from Walrus, decrypts it through Seal, recomputes the SHA-256,
compares it to the on-chain anchor, then reads the mandate and confirms the action was
allowed. It checks the agent rather than trusting it.

## Getting a mandate

Before an agent can anchor, its owner sets a mandate: the single agent address, a cap per
action, a per-epoch cap, an optional target allowlist, and an expiry. The owner then creates
the evidence access that holds the Seal policy. The quickstart in
[`examples/quickstart`](../../examples/quickstart) has a `create-mandate` script that does
both and prints the two ids you paste above.

## Configuration

The SDK targets testnet by default and reads two optional environment variables:

- `AVOW_NETWORK`: `testnet` or `mainnet`.
- `AVOW_PACKAGE_ID`: the published Avow package to anchor against.

Reads run in the browser too, so the same `verify()` powers a dashboard.

## License

Apache-2.0.
