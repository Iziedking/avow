# Avow quickstart

Give an agent a mandate, then prove its actions. Two short scripts, a few minutes, all on
testnet where everything is free.

## What you need

- Node 20 or newer.
- A Sui wallet. If you have the Sui CLI, `sui client new-address ed25519` makes one.
- A little testnet SUI for gas and WAL for storage. Get SUI from the
  [faucet](https://faucet.sui.io/), then swap a bit for WAL:
  `walrus get-wal --context testnet`.

## Set up

```bash
npm install
cp .env.example .env
```

Export your wallet's private key and put it in `.env` as `AVOW_KEY`:

```bash
sui keytool export --key-identity <your-address> --json
```

Copy the `exportedPrivateKey` value (it looks like `suiprivkey1...`) into `AVOW_KEY`.

## Step 1: create a mandate

```bash
npm run create-mandate
```

This sets the limits your agent operates within and creates the evidence access. It prints
two ids. Paste them into `.env`:

```
AVOW_MANDATE_ID=0x...
AVOW_ACCESS_ID=0x...
```

By default the mandate names your own address as the agent, which is fine for trying it out.
To authorize a separate agent wallet, set `AVOW_AGENT_ADDRESS` before running.

## Step 2: run the agent

```bash
npm run agent
```

It does one small on-chain action, then anchors the evidence through Avow and prints a link.
Open the link to see the `ActionAnchored` event on chain. That record is now provable:
anyone you authorize can decrypt the evidence, recompute its hash, and confirm it matches
the anchor and stayed within your mandate.

## Where Avow actually enters your code

Look at `agent.ts`. Everything above the comment is your agent doing its own work. The only
Avow-specific part is the single `anchor()` call. That is the whole integration. Swap the
marker transaction for your real move, fill the bundle with what your agent actually did, and
your agent's track record becomes provable without changing anything else.

See the [`@avow/sdk` README](../../packages/sdk/README.md) for the `anchor` and `verify` API.
