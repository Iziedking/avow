<p align="center">
  <img src="assets/avow-wordmark.png" width="460" alt="Avow: proof, not trust" />
</p>

# Avow

**Proof, not trust.**

AI agents are starting to move real money, paying bills, rebalancing savings, settling invoices.
Every one of them asks for the same thing: trust. Trust that it paid the right merchant, trust
that it stayed inside your limit, trust that the thinking behind the decision was sound. You get
an outcome and a shrug.

Avow replaces the shrug with proof. Build your agent with the Avow SDK and every action it
takes, **and the full reasoning behind it**, is sealed with Seal, stored on Walrus, and anchored
on Sui. Anyone you authorize can later replay exactly what the agent did, *why* it did it, and
confirm it never broke the rules you set. The strategy stays private; the proof is public.

And when one agent serves many people, each person sees only their own. Per-user encryption,
enforced on chain, means your agent's reasoning for you is yours alone, not a promise, a key
nobody else holds.

That same sealed record is also the agent's **memory**, and it ships in the SDK. One call,
`createMemory()`, gives your agent `remember()` and `recall()` on Walrus: it reads its own history
before it acts, tracks state across sessions, and builds over time. A trading agent remembers it
opened a position at 0.71, and when you later say "sell it for profit", it recalls that entry,
checks the price, and only sells if it is genuinely up. Log out, log back in, switch machines, the
context comes with it, portable, verifiable, per-user memory on Walrus. Memory runs on **MemWal
(Walrus Memory)**, proof runs on our Seal-anchored evidence log, and both come from `avow-sdk`.

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
money-moving agent did, *why* it did it, and whether its track record is real, and no way to do
that for an agent shared by many users without leaking one person's history to everyone else.

## What Avow is

Avow is the layer that closes that gap, and it is deliberately strategy-agnostic. A yield
agent, a payment agent, and a trading agent all use the same two calls.

- `anchor(action)` hashes an evidence bundle, encrypts it with Seal, stores the ciphertext on
  Walrus, and records the blob id, the hash, and a few public fields on Sui through
  `record::anchor`. That call evaluates the action against the mandate and stamps the record with
  whether it stayed inside the limits and, if not, which it broke. Every action the agent anchors
  is captured, in bounds or not, so the track record is complete and forensic, and the verdict is
  computed on chain, so the agent cannot dress a rule-breaking action up as compliant.
- `verify(record)` reads the blob back from Walrus, decrypts it with Seal for an authorized
  reader, recomputes the SHA-256, and compares it to the on-chain anchor. It reads the compliance
  verdict the contract stamped at anchor time, so you see exactly which actions stayed inside the
  limits and which broke them. It checks the agent rather than trusting it.

The strategy detail (the rates seen, the prices, the route, the receipts) lives inside the
sealed bundle on Walrus. Only the hash and a few headline fields ever touch the Move event.

The reference agents in this repo, a yield router, a shared bill payer, and a live DeepBook
trading agent, are the proof that the layer works end to end, not the product. The product is
the proof.

## The reasoning, sealed to whoever it was for

An action without its reasoning is half a story. Avow captures the whole story.

As your agent works, it records its reasoning as it goes: what it observed, what it weighed,
which tools it ran, and the decision it landed on. The SDK's `Reasoning` builder keeps this to
one fluent line per step:

```ts
const r = new Reasoning("Pay this month's Netflix bill if it's safe");
r.observe("Read the bill", "Netflix billed 1599, the usual is 1599", { billed: 1599 });
r.tool("Checked the approved billers", "Netflix is on the approved list");
r.think("Checked the per-payment limit", "1599 is within the 5000 limit");
r.decide("Approved and paid", "due, approved, matches the usual, within the limit");
const reasoning = r.build("Paid Netflix 1599");
```

The whole trace goes into the sealed bundle. On the dashboard a consumer doesn't read a number,
they watch the agent think, step by step, with the guarantee that nothing was edited after the
fact.

It does not matter where that reasoning comes from. A **deterministic** agent records its
decision path; an **LLM** agent records the model's chain of thought, the prompt, the data it
acted on. Same call either way, a rule engine and a frontier model plug into the same layer. Our
bill payer is deterministic; an LLM agent integrates with the identical `Reasoning` + `anchor()`.

**One agent, many users, perfect isolation.** Real agents are shared, one bill payer serving a
whole customer base. Avow seals each record to the user it served, using Seal's account-based
policy: the encryption key-id carries the user's address, and `seal_approve` releases a key only
to that user, or to the owner, for support. No per-user setup, no allowlist to maintain, a
user's address *is* their key. Alice can replay every decision the agent made for her; she
physically cannot open Bob's, the key servers refuse her. We tested it live: verifying a shared
agent as Alice returns her records and is denied the rest.

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
- `avow::record` anchors each action, tagged with the user it served, after the mandate check
  passes, and gates Seal decryption through `seal_approve`. It releases a key to a global reader
  the owner added (owner or auditor), or to the individual user a record was sealed to, and no
  one else, which is what makes one shared agent safe for many users.

## Repository

```
contracts/            Move package: avow::mandate and avow::record, with tests
packages/
  sdk/                avow-sdk: the anchor() and verify() calls, published to npm
  agent/              reference agents on the SDK: yield router, bill payer, DeepBook trader
  web/                the verification dashboard and the agent console, built as a Walrus Site
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

The consumer one is a shared bill payer serving two users, Alice and Bob. For each it pays the
safe bills and provably refuses overcharges, unknown billers, and anything over the limit,
recording every decision with its full reasoning and sealing each to the user it served, so on
the dashboard each user only ever sees their own:

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

### The live DeepBook trading agent, end to end

The headline demo needs no developer setup: a real person claims an agent, funds it, and instructs
it in plain English, then verifies the reasoning themselves. The agent's brain is Claude (any LLM
plugs in, and a deterministic parser is the fallback): it reads the instruction, takes the rules
from your words, and trades on DeepBook for real. Start the agent backend alongside the dashboard:

```bash
# .env: ANTHROPIC_API_KEY=sk-ant-... for Claude (else a rule-based parser), and
#       MEMWAL_PRIVATE_KEY + MEMWAL_ACCOUNT_ID (from memory.walrus.xyz) to turn on memory
npx tsx packages/agent/scripts/agent-server.ts   # the agent backend, signs trades autonomously
npm -w @avow/web run dev                          # the dashboard and the console
```

Open `/?console`, connect a wallet, and:

1. **Claim** a personal DeepBook agent: a fresh wallet that signs its own trades with no popups.
   Because it is built with the Avow SDK, at claim time it grants your wallet read access.
2. **Fund** it with a little SUI, its trading capital. The platform seeds the tiny DEEP and WAL it
   needs for fees and storage, so trading never waits on a thin pool.
3. **Instruct** it in plain English, and it talks back. The rule comes from your words, not a
   hardcoded cap: `swap 1 SUI to USDC` does exactly 1 SUI, `buy SUI but don't spend above 5 USDC`
   is enforced and recorded in the proof. It reads the live market, plans with Claude, and acts:
   market swaps across SUI / USDC / DEEP / USDT / BTC / WAL (auto-routing, bridging through USDC
   when needed), resting limit orders, or moving funds in and out of its vault, then seals the
   full reasoning. If it can't do something it says why and suggests an alternative, never a dead end.
4. **It remembers.** Before acting, the agent recalls its own history from Walrus, so it builds
   over time: `buy 0.3 WAL` opens a position it remembers, and a later `sell my WAL for profit`
   recalls the entry price, checks the market, and only sells if it is genuinely up. State that
   survives sessions, portable and verifiable.
5. **Verify** on the Avow home with the same wallet. Your records decrypt for you alone; a
   different wallet is refused by the Seal key servers.

The console stays deliberately terse, a "done" and a link to the transaction. The full reasoning
lives on the Avow home, sealed to your wallet. This is Avow for someone with no developer
knowledge: the wallet is the only identity, and the proof is one click away. The claimed agent
is remembered per wallet, so the next time you connect it greets you with "your agent is active".

The platform keeps small SUI, WAL, and DEEP reserves to fund agents. Top up WAL with the helper,
which swaps on the Walrus exchange (pass `sui` to swap the other way) and never prints your key;
recover DEEP from spent agents with `sweep-deep`:

```bash
npx tsx packages/agent/scripts/get-wal.ts 2      # 2 SUI -> ~2 WAL
npx tsx packages/agent/scripts/sweep-deep.ts     # pull leftover DEEP back to the platform
```

## Roles: owner, agent, auditor

Three roles, which can be one wallet (the quickest start) or three:

- **Owner** creates the mandate and the evidence vault, sets the rules, grants auditors, can
  revoke, and may read its own evidence. On the dashboard, the wallet you connect is the owner.
- **Agent** is the wallet your agent's code signs with. Its address is named in the mandate, and
  the contract lets only that address record actions. This is a key your program holds.
- **Auditor** is any address the owner grants read access, so a third party can verify the
  record without being trusted with anything else.

The wallet is only identity. The reasoning is whatever your code puts in the evidence bundle:
the structured `reasoning` trace (the ordered steps the agent took), plus `observed`,
`rationale`, and `txDigests`. For an LLM agent, each step of the model's chain of thought becomes
a step in the trace, and the data it saw goes in `observed`. Avow then proves the agent committed
to that reasoning, sealed, attributable to a specific user, within the rules, and unaltered
since, not that the model "truly thought" it. That honesty is the stronger claim.

## Integrate your own agent

After your agent does its work, the whole integration is one call:

```ts
import {
  getSuiClient, getSealClient, getWalrusClient, anchor, Reasoning, EVIDENCE_VERSION,
} from "avow-sdk";

const sui = getSuiClient();

// Capture the reasoning as the agent works.
const reasoning = new Reasoning("Pay the invoice the user approved")
  .observe("Read the invoice", "Stripe invoice inv_42 for 1500", { invoiceId: "inv_42" })
  .decide("Approved and paid", "the user pre-approved this invoice")
  .build("Paid Stripe 1500");

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
    user: customerAddress, // this record is sealed to this user; on a shared agent, only they can read it
    reasoning,
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

And memory, from the same SDK. `createMemory()` gives the agent a portable brain on Walrus, so it
remembers what it did and recalls it on the next run, even after a restart or on another machine:

```ts
import { createMemory } from "avow-sdk";

const memory = createMemory(); // reads MEMWAL_PRIVATE_KEY + MEMWAL_ACCOUNT_ID (memory.walrus.xyz)

// After acting, remember it, scoped to the user, encrypted, on Walrus.
await memory.remember(customerAddress, "Paid Stripe inv_42 for 1500 on 2026-06-19.");

// Before acting next time, recall what is relevant; the agent builds over time.
const context = await memory.recall(customerAddress, "what have I paid Stripe recently?");
```

Memory is a no-op when unconfigured, so the same code runs with or without a MemWal account.

The [`examples/quickstart`](examples/quickstart) folder has a `create-mandate` script that
mints the mandate and access for you, plus a runnable agent showing the call in context.

## Command line

Everything the SDK does is also a terminal command, through `avow-cli`. Use it to set a
mandate, anchor an action, and verify a record without writing any code.

It is published to the npm registry, so any package manager installs it. Install it once and the
`avow` command is available everywhere:

```bash
npm i -g avow-cli          # or: pnpm add -g avow-cli  ·  yarn global add avow-cli  ·  bun add -g avow-cli
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
Walrus and stamps the proof on chain, marked with whether the action stayed inside the mandate. An
out-of-bounds amount or target is recorded and flagged, not dropped.

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
it with Seal (only if your key is an authorized reader), recomputes the hash, and reads the
on-chain verdict. It prints whether each record is intact and within the rules or flagged out of
bounds, with a final tally (`N intact, M out of bounds`).

```bash
avow verify --mandate $AVOW_MANDATE_ID
```

Run `avow help` for the full list. The CLI is the same `anchor()` and `verify()` the SDK and
the dashboard use, so a record anchored from the terminal verifies in the browser, and back.

## What it proves, and what it does not

Avow proves two things about every anchored action: the evidence has not been altered since it
was anchored (the on-chain hash binds it), and whether the action stayed inside the mandate, judged
by the contract at the moment it ran and stamped on the record. Every action the agent anchors is
captured, in bounds or not, and the verdict is computed on chain, so an agent cannot pass a
rule-breaking action off as compliant. You get a complete, forensic track record, with each action
marked clean or flagged out of bounds, not just the obedient half.

It does not, on its own, prove that the agent reported the true amount, or that it anchored
every action it took. The mandate holds no funds, so it cannot force either. That last mile is
closed off chain: the evidence bundle carries the actual Sui transfer digests, and the
dashboard reconciles each anchored amount against the transfers those digests describe. We
state this plainly because the honest version is also the stronger one. Hard on-chain
enforcement, where the mandate custodies funds, is the natural next step.

## Memory on Walrus, with proof on top

The Walrus track is about agent memory and verifiable data, and Avow uses both layers together.
The agent's working memory runs on **MemWal (Walrus Memory)**: it remembers each trade and recalls
its own history before it acts, so it tracks state across sessions and builds over time, exactly
the long-running, stateful behavior the track asks for. The memory is not just stored, it is read
and acted on, the agent's positions and prior decisions inform the next one.

On top of that, every action and its full reasoning is anchored as an Avow evidence record. That
is what raw storage (or MemWal alone) does not give a money-moving agent: an integrity proof bound
on chain, authority bounds the record cannot violate, and selective disclosure through Seal so the
strategy stays private while staying verifiable, per user. **MemWal for what the agent remembers,
Avow for proving what it did.** Both are durable, portable, and not locked to our app, the
foundation the track is built on.

## A note on amounts: MIST

Every amount Avow anchors is stored in its smallest on-chain unit, so the proof is exact to the
last digit. For SUI that unit is **MIST**: **1 SUI = 1,000,000,000 MIST**, the same way one
dollar is 100 cents. A one-SUI trade is recorded on chain as `1000000000`. The consumer view
shows the friendly "1 SUI"; the developer view shows the raw MIST, so what is on screen always
matches the on-chain value exactly. Amounts in other units follow the same rule (the bill payer
records US cents, where `1599` is $15.99).

## On chain

Testnet:

- Package: `0xace239ce0defd77ce0c4e570233b37a86ac53377a38ae59749feda3ec9715667`
- Shared bill payer mandate: `0x80d5da99a1d51ed92fbc9cee907ce9b7c7c666b54751ec527108481984a7f32c`


## License

Apache-2.0. See [LICENSE](LICENSE).
