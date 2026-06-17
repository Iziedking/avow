# avow-cli

The Avow command line. Set a mandate, anchor an agent's actions as verifiable evidence, and
verify any record, all from the terminal. It is the developer-facing front door to the same
trust layer the [avow-sdk](https://github.com/Iziedking/avow/tree/main/packages/sdk) powers.

## Install

```bash
npm install -g avow-cli
```

Or run it without installing:

```bash
npx avow-cli help
```

## Auth and network

```bash
export AVOW_KEY=suiprivkey1...   # your Sui private key, or pass --key
export AVOW_NETWORK=testnet      # testnet by default
```

Export a key from the Sui CLI with `sui keytool export --key-identity <address> --json` and
copy the `exportedPrivateKey` value.

## Commands

```bash
# Set what an agent may do, and stand up its evidence access.
avow create-mandate --agent 0xAGENT --per-move 1000000 --daily 10000000

# Anchor an action as sealed, verifiable evidence.
avow anchor --mandate 0xM --access 0xA \
  --action payment --target stripe --amount 1500 --rationale "paid the approved invoice"

# Decrypt and verify a mandate's records (needs a reader key).
avow verify --mandate 0xM

# List a mandate's record, no key needed.
avow records --mandate 0xM
```

`anchor` also accepts a full evidence bundle as JSON with `--bundle path.json`, and one or
more on-chain digests of the real move with `--digest 0x...` (repeatable).

## License

Apache-2.0.
