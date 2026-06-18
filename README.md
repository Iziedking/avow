<p align="center">
  <img src="assets/avow-wordmark.png" width="460" alt="Avow: proof, not trust" />
</p>

# Avow

**Build agents with the Avow SDK so their actions are stored on Walrus, encrypted with Seal, and
become verifiable and provable on Sui.**

Proof, not trust. Your agent does whatever it does. After each action it calls `anchor()`, and
Avow turns that action into a private, tamper-proof record: the evidence is sealed with Seal,
stored on Walrus, and bound to an on-chain anchor that the agent's own mandate had to approve.
Anyone the owner authorizes can later call `verify()` and confirm the record is real,
unaltered, and within the limits that were set.

Built for Sui Overflow 2026, Walrus track.

## The problem

Autonomous agents are starting to move real money: rebalancing yield, paying for data,
settling invoices. Every one of them asks you to trust its numbers. It says it earned 5.3%,
it says it paid the right merchant, it says it stayed inside your limits. You have no way to
check.

Raw on-chain history does not solve this. It shows the transactions, not the reasoning behind
them, not the data the agent paid for and acted on, and not whether the agent reported its
moves honestly or skipped the ones that looked bad. And putting all of that on chain in the
clear would leak the agent's strategy to everyone.

So the gap is specific: there is no way to prove, tamper-evidently and privately, what a
money-moving agent did and whether its track record is real.

## What Avow is

Avow is the layer that closes that gap, and it is deliberately strategy-agnostic. A yield
agent, a payment agent, and a trading agent all use the same two calls.

- `anchor(action)` hashes an evidence bundle, encrypts it with Seal, stores the ciphertext on
  Walrus, and records the blob id, the hash, and a few public fields on Sui through
  `record::anchor`. That call runs the mandate check, so an action whose reported amount or
  target breaks the mandate cannot produce a record at all.
- `verify(record)` reads the blob back from Walrus, decrypts it with Seal for an authorized
  reader, recomputes the SHA-256, and compares it to the on-chain anchor. Then it reads the
  mandate from chain and confirms the action sat inside its limits. It checks the agent
  rather than trusting it.

The strategy detail (the rates seen, the prices, the route, the receipts) lives inside the
sealed bundle on Walrus. Only the hash and a few headline fields ever touch the Move event.

The reference integration in this repo is a simple stablecoin yield agent. It is the proof
that the layer works end to end, not the product. The product is the proof.

## How it works

```
agent acts  ->  anchor()
   hash the evidence bundle (the agent's reasoning, the data it used, the tx digests)
   seal-encrypt it
   store the ciphertext on Walrus
   record::anchor on Sui, which runs the mandate check and emits ActionAnchored

authorized reader  ->  verify()
   read the blob from Walrus
   decrypt with Seal (the key servers dry-run record::seal_approve against the reader)
   recompute the SHA-256
   match it against the on-chain anchor, and confirm the action was within the mandate
```

Two Move modules carry the on-chain half:

- `avow::mandate` declares the agent's authority: a single agent address, a per-action cap, a
  per-epoch cap, an optional allowlist of targets, an expiry, and a revoke. It holds no funds.
- `avow::record` anchors each action after the mandate check passes, and gates Seal
  decryption through `seal_approve`, which only releases a key to an address the owner added
  as a reader.

## Repository

```
contracts/            Move package: avow::mandate and avow::record, with tests
packages/
  sdk/                avow-sdk: the anchor() and verify() calls, published to npm
  agent/              the reference yield agent, a consumer of the SDK
  web/                the verification dashboard, built as a Walrus Site
examples/
  quickstart/         a copy-paste kit to put any agent behind Avow
deployments/          live package and site ids per network
```

## Try it

The contracts, with their full test suite:

```bash
cd contracts
sui move test
```

The SDK round trip on testnet (anchor a real action, then verify it back):

```bash
npx tsx packages/sdk/scripts/e2e.ts
```

The reference agent running one cycle (observe, decide, move, prove):

```bash
npx tsx packages/agent/scripts/run.ts
```

Two reference agents, both built on the SDK, show the two sides of Avow. The DeFi one routes
funds to the best risk-adjusted yield and provably ignores pools that are too risky:

```bash
npx tsx packages/agent/scripts/experiment.ts
```

The consumer one pays bills, and provably refuses overcharges, unknown billers, and anything over
your limit, recording every decision (paid and refused) with its reasoning:

```bash
npx tsx packages/agent/scripts/bills.ts
```

Each prints a mandate id you can paste into the dashboard or verify from the CLI.

The dashboard:

```bash
npm -w @avow/web run dev
```

It opens on a real agent's track record. Watch the agent work plays the reference agent's
decision logic live, and when you connect a wallet and register it as your own agent, the
finale anchors one genuine proof on the spot, signed by that wallet, which then appears in the
record for anyone to verify.

## Roles: owner, agent, auditor

Three roles, which can be one wallet (the quickest start) or three:

- **Owner** creates the mandate and the evidence vault, sets the rules, grants auditors, can
  revoke, and may read its own evidence. On the dashboard, the wallet you connect is the owner.
- **Agent** is the wallet your agent's code signs with. Its address is named in the mandate, and
  the contract lets only that address record actions. This is a key your program holds.
- **Auditor** is any address the owner grants read access, so a third party can verify the
  record without being trusted with anything else.

The wallet is only identity. The reasoning is whatever your code puts in the evidence bundle
(`rationale`, `observed`, `txDigests`). For an LLM agent, you put the model's prompt and output
in `rationale` and the data it saw in `observed`. Avow then proves the agent committed to that
reasoning, sealed, attributable, within the rules, and unaltered since, not that the model
"truly thought" it. That honesty is the stronger claim.

## Integrate your own agent

After your agent does its work, the whole integration is one call:

```ts
import { getSuiClient, getSealClient, getWalrusClient, anchor, EVIDENCE_VERSION } from "avow-sdk";

const sui = getSuiClient();
const proof = await anchor({
  suiClient: sui,
  sealClient: getSealClient(sui),
  walrusClient: getWalrusClient(sui),
  signer: agentKeypair,
  mandateId,
  accessId,
  bundle: {
    version: EVIDENCE_VERSION,
    mandateId,
    agent: agentAddress,
    actionType: "payment",
    target: "stripe",
    amount: "1500",
    rationale: "Paid the invoice the user approved.",
    observed: { invoiceId: "inv_42" },
    before: {},
    after: {},
    txDigests: [actionDigest],
    timestampMs: Date.now(),
  },
});
```

The [`examples/quickstart`](examples/quickstart) folder has a `create-mandate` script that
mints the mandate and access for you, plus a runnable agent showing the call in context.

## Command line

Everything the SDK does is also a terminal command, through `avow-cli`. Use it to set a
mandate, anchor an action, and verify a record without writing any code.

It is published to npm. Install it once and the `avow` command is available everywhere:

```bash
npm i -g avow-cli
avow help
```

Working from a clone of this repo instead? Install the workspace and alias `avow` to the
package script, and every example below reads the same:

```bash
npm install
alias avow='npm -w avow-cli run --silent avow --'
```

Two things it needs to know. Your key, and which network. The key signs your transactions and
decrypts evidence you are allowed to read, so keep it to a throwaway testnet key:

```bash
export AVOW_KEY=suiprivkey1...    # your Sui private key, or pass --key on any command
export AVOW_NETWORK=testnet       # the default, set mainnet to switch
```

**Set what an agent may do.** This mints the mandate (the rules) and the access object (the
evidence vault), and prints their ids. You become the owner; the agent address you name is the
only one that can anchor against it. Leave `--agent` off to name your own address.

```bash
avow create-mandate --agent 0xAGENT --per-move 1000000 --daily 10000000
```

It prints `AVOW_MANDATE_ID`, `AVOW_ACCESS_ID`, and an admin cap. Keep the cap safe; it is what
lets you grant auditors later. Export the first two for the commands below:

```bash
export AVOW_MANDATE_ID=0x...   AVOW_ACCESS_ID=0x...
```

**Anchor an action.** Run this as the agent (its key in `AVOW_KEY`). It seals the evidence on
Walrus and stamps the proof on chain. An amount or target that breaks the mandate will not
anchor at all.

```bash
avow anchor --mandate $AVOW_MANDATE_ID --access $AVOW_ACCESS_ID \
  --action payment --target stripe --amount 1500 --rationale "paid the approved invoice"
```

For richer evidence (observed data, before and after state, transfer digests), pass a JSON
bundle instead: `avow anchor --mandate ... --access ... --bundle ./action.json`.

**List the track record.** Read-only, no key required. Anyone can see what was anchored.

```bash
avow records --mandate $AVOW_MANDATE_ID
```

**Verify privately.** This is the point of Avow. It reads each blob back from Walrus, decrypts
it with Seal (only if your key is an authorized reader), recomputes the hash, and confirms each
action sat inside the mandate. It prints `ok` or `FAIL` per record and a final tally.

```bash
avow verify --mandate $AVOW_MANDATE_ID
```

Run `avow help` for the full list. The CLI is the same `anchor()` and `verify()` the SDK and
the dashboard use, so a record anchored from the terminal verifies in the browser, and back.

## What it proves, and what it does not

Avow proves two things about every anchored action: the evidence has not been altered since it
was anchored (the on-chain hash binds it), and the action was inside the declared limits (the
anchor could not exist otherwise).

It does not, on its own, prove that the agent reported the true amount, or that it anchored
every action it took. The mandate holds no funds, so it cannot force either. That last mile is
closed off chain: the evidence bundle carries the actual Sui transfer digests, and the
dashboard reconciles each anchored amount against the transfers those digests describe. We
state this plainly because the honest version is also the stronger one. Hard on-chain
enforcement, where the mandate custodies funds, is the natural next step.

## Why not just store memory on Walrus

The Walrus track is about agent memory and verifiable data. Avow's anchored evidence log is
exactly that: a durable, portable, verifiable record an agent and its auditors build over
time. MemWal is the off-the-shelf way to put agent memory on Walrus, and you could store the
same bundles with it. Avow adds the three things a money-moving agent actually needs on top of
storage: an integrity proof bound on chain, authority bounds the record cannot violate, and
selective disclosure through Seal so the strategy stays private while staying verifiable.

## On chain

Testnet, recorded in [`deployments/testnet.json`](deployments/testnet.json):

- Package: `0x635babba8ed8ff326830ac22b77d6e3a541824926292135e8d68248760a5ff6e`
- Reference mandate: `0x0f893eb746e08ae348d1389f3c633b282966218e784e8f142bf0acaa60184c11`


## License

Apache-2.0. See [LICENSE](LICENSE).
