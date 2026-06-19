// The agent's long-term memory, on Walrus via MemWal (Walrus Memory). Each trade the agent makes
// is remembered; before it acts, it recalls what it already did so it can build over time, hold a
// position, and "sell for profit later". Memory is scoped per user (namespace = the owner wallet),
// so on a shared agent each user's history stays isolated, matching Avow's per-user proof model.
//
// Set MEMWAL_PRIVATE_KEY (delegate key) and MEMWAL_ACCOUNT_ID in .env (from memory.walrus.xyz).
// Without them, memory is simply off and the agent still trades, just statelessly.

import { MemWal } from "@mysten-incubation/memwal";

let client: MemWal | null = null;

function get(): MemWal | null {
  if (client) return client;
  const key = process.env.MEMWAL_PRIVATE_KEY;
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  if (!key || !accountId) return null;
  client = MemWal.create({
    key,
    accountId,
    serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
    namespace: "avow",
  });
  return client;
}

export function hasMemory(): boolean {
  return !!(process.env.MEMWAL_PRIVATE_KEY && process.env.MEMWAL_ACCOUNT_ID);
}

// One memory space per user, so each wallet recalls only its own history.
const ns = (owner: string) => `avow-${owner.toLowerCase().slice(2, 14)}`;

// Recall what the agent has done for this user that is relevant to the instruction.
export async function recall(owner: string, query: string, limit = 6): Promise<string[]> {
  const m = get();
  if (!m) return [];
  try {
    const r = await m.recall({ query, limit, namespace: ns(owner) });
    return (r.results ?? []).map((x: { text: string }) => x.text).filter(Boolean);
  } catch (e) {
    console.error("memwal recall failed:", (e as Error).message);
    return [];
  }
}

// Remember a trade the agent just made, so future instructions can build on it.
export async function remember(owner: string, text: string): Promise<void> {
  const m = get();
  if (!m) return;
  try {
    await m.rememberAndWait(text, ns(owner), { timeoutMs: 30_000 });
  } catch (e) {
    console.error("memwal remember failed:", (e as Error).message);
  }
}
