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

  // One memory space per user, so each wallet recalls only its own history. Facts (trades,
  // decisions) and conversation turns live in separate spaces, so recalling "what did I buy" never
  // dredges up the chatter, and the agent never reinforces its own earlier replies.
  private ns(user: string): string {
    return `avow-${user.toLowerCase().replace(/^0x/, "").slice(0, 12)}`;
  }
  private chatNs(user: string): string {
    return `${this.ns(user)}-chat`;
  }

  // Recall with a couple of retries: the relayer occasionally drops a request ("fetch failed"), and
  // a stalled lookup must never sink a live answer.
  private async tryRecall(query: string, limit: number, namespace: string): Promise<string[]> {
    if (!this.client) return [];
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await this.client.recall({ query, limit, namespace });
        return (r.results ?? []).map((x: { text: string }) => x.text).filter(Boolean);
      } catch (e) {
        lastErr = e;
      }
    }
    console.error("avow memory: recall failed:", (lastErr as Error)?.message);
    return [];
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

  /** Recall what is relevant to a query, by meaning, from this user's facts on Walrus. Conversation
   *  turns are excluded (they live in their own space; legacy ones are filtered by prefix). */
  async recall(user: string, query: string, limit = 6): Promise<string[]> {
    const out = await this.tryRecall(query, limit, this.ns(user));
    return out.filter((t) => !t.startsWith(CHAT_PREFIX));
  }

  /** Remember one conversation turn (in the chat space), so the agent picks the thread back up
   *  after logout/login without polluting its fact recall. */
  async rememberTurn(user: string, turn: ConversationTurn): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.rememberAndWait(`${turn.role}: ${turn.text}`, this.chatNs(user), { timeoutMs: 30_000 });
    } catch (e) {
      console.error("avow memory: rememberTurn failed:", (e as Error).message);
    }
  }

  /** Recover the recent conversation with this user from Walrus, so logging back in carries
   *  context, the agent remembers what you were doing together. */
  async recallConversation(user: string, limit = 8): Promise<ConversationTurn[]> {
    const out = await this.tryRecall("our recent conversation, what we discussed and decided", limit, this.chatNs(user));
    return out.map((t): ConversationTurn => {
      const role: ConversationTurn["role"] = t.startsWith("agent:") ? "agent" : "user";
      return { role, text: t.replace(/^(user|agent):\s*/, "") };
    });
  }
}

/** Create an Avow memory client. Any agent built with the Avow SDK gets memory on Walrus, sealed,
 *  and carried everywhere. */
export function createMemory(config: AvowMemoryConfig = {}): AvowMemory {
  return new AvowMemory(config);
}
