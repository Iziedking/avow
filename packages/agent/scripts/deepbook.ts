// The agent's hands: everything it can actually do on DeepBook (Sui testnet). Market swaps across
// several token pairs, resting limit orders (DeepBook's form of providing liquidity), and a
// per-agent BalanceManager vault that orders draw from (deposit / withdraw). The brain decides
// what to do; this module carries it out and reports back in plain terms.

import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { DeepBookClient } from "@mysten/deepbook-v3";
import { getSuiClient } from "avow-sdk";
import type { Token } from "./brain";

const sui = getSuiClient();

// Testnet coin types (from the DeepBook SDK's testnet registry).
export const COIN_TYPE: Record<Token, string> = {
  SUI: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
  DEEP: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
  DBUSDC: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
  DBUSDT: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDT::DBUSDT",
  DBTC: "0x6502dae813dbe5e42643c119a6450a518481f03063febc7e20238e43b6ea9e86::dbtc::DBTC",
  WAL: "0x9ef7676a9f81937a52ae4b2af8d511a28a0b080477c0c2db40b0ab8882240d76::wal::WAL",
};

// Smallest-unit scalar per token (DeepBook testnet): SUI/WAL are 9 dp, DEEP/DBUSDC/DBUSDT 6, DBTC 8.
export const SCALAR: Record<Token, number> = {
  SUI: 1e9,
  WAL: 1e9,
  DEEP: 1e6,
  DBUSDC: 1e6,
  DBUSDT: 1e6,
  DBTC: 1e8,
};

// pool -> [base, quote]. The agent trades the pairs the platform can fund. WAL here is DeepBook's
// tradeable WAL (0x9ef7...), distinct from the storage WAL the platform uses for Walrus.
export const POOL_PAIRS: Record<string, [Token, Token]> = {
  SUI_DBUSDC: ["SUI", "DBUSDC"],
  DEEP_DBUSDC: ["DEEP", "DBUSDC"],
  DBUSDT_DBUSDC: ["DBUSDT", "DBUSDC"],
  DBTC_DBUSDC: ["DBTC", "DBUSDC"],
  WAL_DBUSDC: ["WAL", "DBUSDC"],
  WAL_SUI: ["WAL", "SUI"],
  DEEP_SUI: ["DEEP", "SUI"],
};
export const POOLS = Object.keys(POOL_PAIRS);
export const TRADEABLE: Token[] = ["SUI", "DBUSDC", "DEEP", "DBUSDT", "DBTC", "WAL"];

const MANAGER_KEY = "AGENT";

export function makeDB(address: string, managerAddress?: string): DeepBookClient {
  return new DeepBookClient({
    client: sui as never,
    address,
    network: "testnet",
    balanceManagers: managerAddress ? { [MANAGER_KEY]: { address: managerAddress } } : undefined,
  } as never);
}

// Sign + execute, retrying transient gas-object version races (the SDK asks to "rebuild").
export async function execWithRetry(build: () => Promise<Transaction>, signer: Ed25519Keypair, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await sui.signAndExecuteTransaction({ transaction: await build(), signer, options: { showEffects: true } });
      await sui.waitForTransaction({ digest: res.digest });
      if (res.effects?.status?.status !== "success") throw new Error(res.effects?.status?.error ?? "transaction failed");
      return res;
    } catch (e) {
      const msg = (e as Error).message;
      if (i < tries - 1 && /unavailable for consumption|needs to be rebuilt|equivocat|reserved|not available/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

// Find a direct pool that connects two tokens, and which way we'd trade it.
function directRoute(from: Token, to: Token): { poolKey: string; baseForQuote: boolean } | null {
  for (const [poolKey, [base, quote]] of Object.entries(POOL_PAIRS)) {
    if (from === base && to === quote) return { poolKey, baseForQuote: true }; // sell base, get quote
    if (from === quote && to === base) return { poolKey, baseForQuote: false }; // spend quote, get base
  }
  return null;
}

// Route a swap directly, or via DBUSDC as a bridge (two hops).
export function routeSwap(from: Token, to: Token): Token[] {
  if (from === to) return [];
  if (directRoute(from, to)) return [from, to];
  if (directRoute(from, "DBUSDC") && directRoute("DBUSDC", to)) return [from, "DBUSDC", to];
  throw new Error(`no DeepBook route from ${from} to ${to}`);
}

export async function balance(addr: string, token: Token): Promise<number> {
  const b = await sui.getBalance({ owner: addr, coinType: COIN_TYPE[token] });
  return Number(b.totalBalance) / SCALAR[token];
}

// Mid prices barely move within a short window and the on-chain reads are the slow part, so cache
// them briefly across instructions. Balances are always read fresh, they change as the agent trades.
let priceCache: { at: number; prices: Record<string, number> } | null = null;

export async function marketSnapshot(addr: string) {
  const db = makeDB(addr);
  const balances: Record<string, number> = {};
  const now = Date.now();
  const fresh = priceCache !== null && now - priceCache.at < 10_000;
  const prices: Record<string, number> = fresh ? priceCache!.prices : {};
  // Read balances (and prices, only when the cache is cold) all at once.
  await Promise.all([
    ...TRADEABLE.map(async (t) => {
      balances[t] = await balance(addr, t);
    }),
    ...(fresh
      ? []
      : POOLS.map(async (p) => {
          try {
            prices[p] = Number((await db.midPrice(p)).toFixed(6));
          } catch {
            /* pool may be empty; skip */
          }
        })),
  ]);
  if (!fresh) priceCache = { at: now, prices };
  return { balances, prices, pools: POOLS };
}

// DeepBook charges a DEEP taker fee on these pools. The agent normally arrives with seed DEEP from
// the platform; this only kicks in if it has run low, topping up from the DEEP_SUI pool when that
// pool is liquid. 0.03 DEEP is plenty for a swap (a swap costs ~0.022).
export async function ensureDeep(kp: Ed25519Keypair, addr: string) {
  const bal = await sui.getBalance({ owner: addr, coinType: COIN_TYPE.DEEP });
  if (Number(bal.totalBalance) >= 30_000) return;
  const db = makeDB(addr);
  await execWithRetry(async () => {
    const t = new Transaction();
    const [b, q, d] = t.add(db.deepBook.swapExactQuoteForBase({ poolKey: "DEEP_SUI", amount: 0.5, deepAmount: 0, minOut: 0 }));
    t.transferObjects([b, q, d], addr);
    return t;
  }, kp);
  const after = await sui.getBalance({ owner: addr, coinType: COIN_TYPE.DEEP });
  if (Number(after.totalBalance) < 30_000) throw new Error("out of DEEP for fees and the DEEP_SUI pool is dry right now; the platform reserve will cover the next claim");
}

// Execute one direct swap hop. Returns the amount received and the tx digest.
async function swapHop(kp: Ed25519Keypair, addr: string, from: Token, to: Token, amount: number): Promise<{ received: number; digest: string }> {
  const route = directRoute(from, to);
  if (!route) throw new Error(`no direct pool for ${from}->${to}`);
  const db = makeDB(addr);
  // Quote first: if it would fill ~nothing, the amount is below the pool's minimum size. Stop here
  // rather than burn a transaction and report a phantom swap.
  const expectedOut = route.baseForQuote
    ? (await db.getQuoteQuantityOut(route.poolKey, amount)).quoteOut
    : (await db.getBaseQuantityOut(route.poolKey, amount)).baseOut;
  if (!expectedOut || expectedOut <= 0) {
    throw new Error(`${amount} ${from} is below DeepBook's minimum trade size for ${from}/${to}; try a larger amount`);
  }
  const before = await balance(addr, to);
  const res = await execWithRetry(async () => {
    const tx = new Transaction();
    if (route.baseForQuote) {
      const quote = await db.getQuoteQuantityOut(route.poolKey, amount);
      const [b, q, d] = tx.add(db.deepBook.swapExactBaseForQuote({ poolKey: route.poolKey, amount, deepAmount: quote.deepRequired, minOut: 0 }));
      tx.transferObjects([b, q, d], addr);
    } else {
      const quote = await db.getBaseQuantityOut(route.poolKey, amount);
      const [b, q, d] = tx.add(db.deepBook.swapExactQuoteForBase({ poolKey: route.poolKey, amount, deepAmount: quote.deepRequired, minOut: 0 }));
      tx.transferObjects([b, q, d], addr);
    }
    return tx;
  }, kp);
  return { received: (await balance(addr, to)) - before, digest: res?.digest ?? "" };
}

export interface SwapResult {
  received: number;
  digest: string;
}

// Swap `amount` of `from` into `to`, directly or via a DBUSDC bridge.
export async function swap(kp: Ed25519Keypair, addr: string, from: Token, to: Token, amount: number): Promise<SwapResult> {
  await ensureDeep(kp, addr);
  const path = routeSwap(from, to);
  let carryToken = from;
  let carryAmount = amount;
  let received = amount;
  let digest = "";
  for (let i = 1; i < path.length; i++) {
    const next = path[i];
    const hop = await swapHop(kp, addr, carryToken, next, carryAmount);
    carryAmount = hop.received;
    received = hop.received;
    digest = hop.digest;
    carryToken = next;
  }
  return { received, digest };
}

// ---- BalanceManager (the trading vault) + limit orders ----

// Create and share a BalanceManager, return its object id.
export async function createManager(kp: Ed25519Keypair, addr: string): Promise<string> {
  const db = makeDB(addr);
  const res = await execWithRetry(async () => {
    const tx = new Transaction();
    tx.add(db.balanceManager.createAndShareBalanceManager());
    return tx;
  }, kp);
  // The created shared object is the BalanceManager.
  const created = (res?.effects?.created ?? []).map((c) => c.reference.objectId);
  for (const id of created) {
    const obj = await sui.getObject({ id, options: { showType: true } });
    if (obj.data?.type?.includes("balance_manager::BalanceManager")) return id;
  }
  if (created.length) return created[0];
  throw new Error("could not find the created BalanceManager");
}

export async function deposit(kp: Ed25519Keypair, addr: string, managerId: string, coin: Token, amount: number) {
  const db = makeDB(addr, managerId);
  await execWithRetry(async () => {
    const tx = new Transaction();
    tx.add(db.balanceManager.depositIntoManager(MANAGER_KEY, coin, amount));
    return tx;
  }, kp);
}

export async function withdraw(kp: Ed25519Keypair, addr: string, managerId: string, coin: Token, amount: number) {
  const db = makeDB(addr, managerId);
  await execWithRetry(async () => {
    const tx = new Transaction();
    tx.add(db.balanceManager.withdrawFromManager(MANAGER_KEY, coin, amount, addr));
    return tx;
  }, kp);
}

// Place a resting limit order (provide liquidity). side "buy" rests a bid, "sell" rests an ask.
export async function placeLimit(kp: Ed25519Keypair, addr: string, managerId: string, poolKey: string, side: "buy" | "sell", price: number, quantity: number) {
  const db = makeDB(addr, managerId);
  await execWithRetry(async () => {
    const tx = new Transaction();
    tx.add(
      db.deepBook.placeLimitOrder({
        poolKey,
        balanceManagerKey: MANAGER_KEY,
        clientOrderId: String(Math.floor(quantity * 1e6)),
        price,
        quantity,
        isBid: side === "buy",
        payWithDeep: true,
      }),
    );
    return tx;
  }, kp);
}

export async function cancelAll(kp: Ed25519Keypair, addr: string, managerId: string, poolKey: string) {
  const db = makeDB(addr, managerId);
  await execWithRetry(async () => {
    const tx = new Transaction();
    tx.add(db.deepBook.cancelAllOrders(poolKey, MANAGER_KEY));
    return tx;
  }, kp);
}
