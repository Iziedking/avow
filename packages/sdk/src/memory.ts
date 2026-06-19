// Avow memory: an agent built with the Avow SDK carries its memory on Walrus, sealed, and recalls
// it anywhere. Memory of what the agent and the user have done together, durable across logout and
// login, portable across apps and machines. It runs on MemWal (Walrus Memory); set
// MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID (from memory.walrus.xyz), or pass them to createMemory().
//
// This is the second half of Avow: anchor()/verify() prove what an agent did; remember()/recall()
// give it a portable, verifiable brain. Both live on Walrus, both come from one SDK.

import { MemWal } from "@mysten-incubation/memwal";

function env(key: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[key] : undefined;
}

export interface AvowMemoryConfig {
  /** Delegate private key. Falls back to MEMWAL_PRIVATE_KEY. */
  key?: string;
  /** MemWal account object id on Sui. Falls back to MEMWAL_ACCOUNT_ID. */
  accountId?: string;
  /** Relayer URL. Falls back to MEMWAL_SERVER_URL, then the hosted relayer. */
  serverUrl?: string;
}

export interface ConversationTurn {
  role: "user" | "agent";
  text: string;
}

const CHAT_PREFIX = "[chat]";

/** A per-user, portable memory an Avow agent keeps on Walrus. Disabled (a no-op) when unconfigured,
 *  so the agent still runs, just statelessly, without a MemWal account. */
export class AvowMemory {
  private client: MemWal | null = null;

  constructor(config: AvowMemoryConfig = {}) {
    const key = config.key ?? env("MEMWAL_PRIVATE_KEY");
    const accountId = config.accountId ?? env("MEMWAL_ACCOUNT_ID");
    if (!key || !accountId) return;
    this.client = MemWal.create({
      key,
      accountId,
      serverUrl: config.serverUrl ?? env("MEMWAL_SERVER_URL") ?? "https://relayer.memory.walrus.xyz",
      namespace: "avow",
    });
  }

  /** Whether memory is configured and live. */
  get enabled(): boolean {
    return this.client !== null;
  }

  // One memory space per user, so each wallet recalls only its own history.
  private ns(user: string): string {
    return `avow-${user.toLowerCase().replace(/^0x/, "").slice(0, 12)}`;
  }

  /** Remember a durable fact for this user (a trade, a decision, a preference). Stored on Walrus,
   *  encrypted, scoped to the user, and recoverable from any machine. */
  async remember(user: string, text: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.rememberAndWait(text, this.ns(user), { timeoutMs: 30_000 });
    } catch (e) {
      console.error("avow memory: remember failed:", (e as Error).message);
    }
  }

  /** Recall what is relevant to a query, by meaning, from this user's memory on Walrus. */
  async recall(user: string, query: string, limit = 6): Promise<string[]> {
    if (!this.client) return [];
    try {
      const r = await this.client.recall({ query, limit, namespace: this.ns(user) });
      return (r.results ?? []).map((x: { text: string }) => x.text).filter(Boolean);
    } catch (e) {
      console.error("avow memory: recall failed:", (e as Error).message);
      return [];
    }
  }

  /** Remember one conversation turn, so the agent can pick the thread back up after logout/login. */
  async rememberTurn(user: string, turn: ConversationTurn): Promise<void> {
    await this.remember(user, `${CHAT_PREFIX} ${turn.role}: ${turn.text}`);
  }

  /** Recover the recent conversation with this user from Walrus, so logging back in carries
   *  context, the agent remembers what you were doing together. */
  async recallConversation(user: string, limit = 8): Promise<ConversationTurn[]> {
    const lines = await this.recall(user, "our recent conversation, what we discussed and decided", limit);
    return lines
      .filter((l) => l.startsWith(CHAT_PREFIX))
      .map((l) => {
        const body = l.slice(CHAT_PREFIX.length).trim();
        const role: ConversationTurn["role"] = body.startsWith("agent:") ? "agent" : "user";
        return { role, text: body.replace(/^(user|agent):\s*/, "") };
      });
  }
}

/** Create an Avow memory client. Any agent built with the Avow SDK gets memory on Walrus, sealed,
 *  and carried everywhere. */
export function createMemory(config: AvowMemoryConfig = {}): AvowMemory {
  return new AvowMemory(config);
}
