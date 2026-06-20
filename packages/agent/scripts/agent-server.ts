// The backend for the Agent console (Model C): each user claims a personal DeepBook trading
// agent. The agent is a fresh wallet that signs its own actions (autonomous, no popups). Because
// it's built with the Avow SDK, at claim time it creates its mandate and GRANTS the connecting
// wallet read access, so that wallet can verify the agent's reasoning on the Avow home. The user
// funds the agent with SUI (its trading capital); the platform tops up the tiny DEEP + WAL the
// agent needs for fees and storage.
//
// Run from the repo root: npx tsx packages/agent/scripts/agent-server.ts
// Env: AVOW_KEY (platform key that funds plumbing), AGENT_PORT (default 8787).

import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  getSuiClient, getSealClient, getWalrusClient, createMandate, anchor, verify, createSession,
  listRecords, breachLabels, Reasoning, createMemory, EVIDENCE_VERSION, PACKAGE_ID, NETWORK,
} from "avow-sdk";
import { makePlan, makeReasoning, hasLLMKey, type Plan, type PlanStep, type Token } from "./brain";
import { marketSnapshot, swap, placeLimit, deposit, withdraw, cancelAll, createManager, execWithRetry, balance, POOL_PAIRS, COIN_TYPE } from "./deepbook";

// Load .env ourselves (tsx does not), so ANTHROPIC_API_KEY and friends are picked up.
function loadDotenv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotenv();

const WAL_TYPE = "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL";
const PORT = Number(process.env.AGENT_PORT ?? 8787);
// On-chain safety ceilings only. The real per-action rule comes from the user's instruction: the
// brain reads the limit out of the prompt ("swap 1 SUI" -> 1 SUI, "don't spend above 5 USDC" -> 5
// USDC) and the executor enforces it, so the proof shows the agent obeyed your words. These caps
// are a generous backstop the mandate can never exceed, not a number you have to set.
const PER_MOVE_CAP = 1_000_000_000_000n; // 1000 SUI-equivalent
const DAILY_CAP = 10_000_000_000_000n; // 10000 SUI-equivalent

function loadPlatform(): Ed25519Keypair {
  const key = process.env.AVOW_KEY;
  if (key) return Ed25519Keypair.fromSecretKey(key);
  const f = JSON.parse(readFileSync(".firecrawl/devkey.json", "utf8"));
  return Ed25519Keypair.fromSecretKey(f.exportedPrivateKey as string);
}

// Never let one bad agent action take down the server.
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e instanceof Error ? e.message : e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e.message));

const platform = loadPlatform();
const platformAddr = platform.getPublicKey().toSuiAddress();
const sui = getSuiClient();
const seal = getSealClient(sui);
const walrus = getWalrusClient(sui);
// The agent's portable brain on Walrus (reads MEMWAL_* from the environment).
const memory = createMemory();

// Claimed agents: mandateId -> { keypair, accessId, owner }. Persisted to disk so a returning
// wallet finds its agent (and its signer survives a server restart). The file holds agent secret
// keys, so it lives under .firecrawl/ (gitignored); fine for a testnet demo, a real deployment
// would keep these in a KMS.
// Override with AVOW_AGENTS_FILE to point at a mounted volume in a container deployment.
const AGENTS_FILE = process.env.AVOW_AGENTS_FILE ?? ".firecrawl/agents.json";
type Agent = { kp: Ed25519Keypair; accessId: string; owner: string; managerId?: string };

function loadAgents(): Map<string, Agent> {
  const m = new Map<string, Agent>();
  if (!existsSync(AGENTS_FILE)) return m;
  try {
    const arr = JSON.parse(readFileSync(AGENTS_FILE, "utf8")) as Array<{ mandateId: string; secretKey: string; accessId: string; owner: string; managerId?: string }>;
    for (const a of arr) m.set(a.mandateId, { kp: Ed25519Keypair.fromSecretKey(a.secretKey), accessId: a.accessId, owner: a.owner, managerId: a.managerId });
  } catch (e) {
    console.error("could not read agents file:", (e as Error).message);
  }
  return m;
}

const agents = loadAgents();

// This session's back-and-forth per mandate, so the agent understands follow-ups like "use 0.5".
// In-memory only (short-term); long-term memory is MemWal. Trimmed to the recent turns.
const conversations = new Map<string, { role: "user" | "agent"; text: string }[]>();

function saveAgents() {
  const arr = [...agents.entries()].map(([mandateId, e]) => ({ mandateId, secretKey: e.kp.getSecretKey(), accessId: e.accessId, owner: e.owner, managerId: e.managerId }));
  mkdirSync(dirname(AGENTS_FILE), { recursive: true });
  writeFileSync(AGENTS_FILE, JSON.stringify(arr, null, 2));
}

// A BalanceManager (the trading vault) is created lazily the first time an agent needs one (for
// limit orders or vault deposits), then remembered.
async function ensureManager(entry: Agent, addr: string): Promise<string> {
  if (entry.managerId) return entry.managerId;
  const id = await createManager(entry.kp, addr);
  entry.managerId = id;
  saveAgents();
  return id;
}

// The agent most recently claimed by this wallet, if any.
function agentForOwner(owner: string): { agentAddress: string; mandateId: string } | null {
  let found: { agentAddress: string; mandateId: string } | null = null;
  for (const [mandateId, e] of agents) {
    if (e.owner.toLowerCase() === owner.toLowerCase()) found = { agentAddress: e.kp.getPublicKey().toSuiAddress(), mandateId };
  }
  return found;
}

// ---- Developer / admin surface: an owner administers the mandates it claimed, and the SDK is
// exercised live (grant an auditor, revoke a mandate, verify a proof, remember/recall). The
// MandateCap for each mandate is held by its agent (it created the mandate), and the server holds
// the agent keys, so it signs on the connecting owner's authority. ----

function ownerMandates(owner: string) {
  const out: { mandateId: string; agentAddress: string; accessId: string }[] = [];
  for (const [mandateId, e] of agents) {
    if (e.owner.toLowerCase() === owner.toLowerCase())
      out.push({ mandateId, agentAddress: e.kp.getPublicKey().toSuiAddress(), accessId: e.accessId });
  }
  return out;
}

function ownedEntry(owner: string, mandateId: string) {
  const e = agents.get(mandateId);
  if (!e) throw new Error("unknown mandate");
  if (e.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("that mandate is not yours to administer");
  return e;
}

async function capIdForAgent(agentAddr: string, mandateId: string): Promise<string> {
  const res = await sui.getOwnedObjects({ owner: agentAddr, filter: { StructType: `${PACKAGE_ID}::mandate::MandateCap` }, options: { showContent: true } });
  for (const o of res.data) {
    const f = (o.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
    if (f && String(f.mandate_id) === mandateId) return o.data!.objectId;
  }
  throw new Error("MandateCap not found for that mandate");
}

// List the owner's mandates with on-chain status: revoked? how many proofs anchored?
async function devMandates(owner: string) {
  const mine = ownerMandates(owner);
  const mandates = await Promise.all(
    mine.map(async (m) => {
      let revoked = false;
      let records = 0;
      let flagged = 0;
      try {
        const obj = await sui.getObject({ id: m.mandateId, options: { showContent: true } });
        revoked = Boolean((obj.data?.content as { fields?: { revoked?: unknown } } | undefined)?.fields?.revoked);
      } catch {
        /* unreadable; leave as not-revoked */
      }
      try {
        const recs = await listRecords(sui, m.mandateId, 25);
        records = recs.length;
        flagged = recs.filter((x) => x.withinMandate === false).length;
      } catch {
        /* event read failed; leave at 0 */
      }
      return { ...m, revoked, records, flagged };
    }),
  );
  return { admin: owner, platform: platformAddr, isPlatform: owner.toLowerCase() === platformAddr.toLowerCase(), mandates };
}

// Grant an auditor read access (record::add_auditor), signed by the agent cap on the owner's authority.
async function devGrant(owner: string, mandateId: string, auditor: string) {
  const e = ownedEntry(owner, mandateId);
  const capId = await capIdForAgent(e.kp.getPublicKey().toSuiAddress(), mandateId);
  const res = await execWithRetry(async () => {
    const tx = new Transaction();
    tx.moveCall({ target: `${PACKAGE_ID}::record::add_auditor`, arguments: [tx.object(e.accessId), tx.object(capId), tx.pure.address(auditor)] });
    return tx;
  }, e.kp);
  return { ok: true, mandateId, auditor, digest: res!.digest };
}

// The owner's kill switch: revoke the whole mandate (mandate::revoke); the agent can no longer act.
async function devRevoke(owner: string, mandateId: string) {
  const e = ownedEntry(owner, mandateId);
  const capId = await capIdForAgent(e.kp.getPublicKey().toSuiAddress(), mandateId);
  const res = await execWithRetry(async () => {
    const tx = new Transaction();
    tx.moveCall({ target: `${PACKAGE_ID}::mandate::revoke`, arguments: [tx.object(mandateId), tx.object(capId)] });
    return tx;
  }, e.kp);
  return { ok: true, mandateId, digest: res!.digest };
}

// Verify the latest anchored proof the way an auditor would: read from Walrus, decrypt via Seal,
// recompute the hash, check it sits within the mandate. The agent is a valid reader of its own
// evidence, so the server can run verify() end to end as a live SDK demo.
async function devVerify(owner: string, mandateId: string) {
  const e = ownedEntry(owner, mandateId);
  const records = await listRecords(sui, mandateId, 10);
  if (!records.length) throw new Error("no proofs anchored for this mandate yet; instruct the agent first");
  const record = records[0];
  const sessionKey = await createSession(sui, e.kp);
  const r = await verify({ suiClient: sui, sealClient: seal, walrusClient: walrus, sessionKey, record });
  const reasoning = r.bundle.reasoning as { goal?: string; steps?: { title: string }[] } | undefined;
  return {
    record: { actionType: record.actionType, amount: record.amount, target: record.target, txDigest: record.txDigest },
    result: {
      hashMatches: r.hashMatches,
      amountMatches: r.amountMatches,
      withinMandate: r.withinMandate,
      breaches: r.breaches,
      breachLabels: breachLabels(r.breaches),
    },
    goal: reasoning?.goal,
    steps: (reasoning?.steps ?? []).map((s) => s.title),
    rationale: r.bundle.rationale,
  };
}

// Fund a fresh agent with gas SUI + WAL (storage) + DEEP (DeepBook taker fees) in one atomic tx,
// so trading never depends on the live DEEP_SUI pool (which goes dry on testnet). 0.15 DEEP covers
// several swaps; the platform keeps a DEEP reserve and tops it up when the pools are liquid.
async function fundPlumbing(agentAddr: string) {
  await execWithRetry(async () => {
    const wal = await sui.getCoins({ owner: platformAddr, coinType: WAL_TYPE });
    if (!wal.data.length) throw new Error("platform has no WAL");
    const deep = await sui.getCoins({ owner: platformAddr, coinType: COIN_TYPE.DEEP });
    if (!deep.data.length) throw new Error("platform has no DEEP reserve");
    const tx = new Transaction();
    const [gas] = tx.splitCoins(tx.gas, [400_000_000]); // 0.4 SUI for gas
    const walPrimary = tx.object(wal.data[0].coinObjectId);
    if (wal.data.length > 1) tx.mergeCoins(walPrimary, wal.data.slice(1).map((c) => tx.object(c.coinObjectId)));
    const [walPart] = tx.splitCoins(walPrimary, [40_000_000]); // 0.04 WAL
    const deepPrimary = tx.object(deep.data[0].coinObjectId);
    if (deep.data.length > 1) tx.mergeCoins(deepPrimary, deep.data.slice(1).map((c) => tx.object(c.coinObjectId)));
    const [deepPart] = tx.splitCoins(deepPrimary, [150_000]); // 0.15 DEEP (6 dp)
    tx.transferObjects([gas, walPart, deepPart], agentAddr);
    return tx;
  }, platform);
}

async function claim(owner: string) {
  const kp = new Ed25519Keypair();
  const agentAddr = kp.getPublicKey().toSuiAddress();
  await fundPlumbing(agentAddr);

  // The agent creates its own mandate + evidence access.
  const m = await createMandate(sui, kp, { agent: agentAddr, perMoveCap: PER_MOVE_CAP, dailyCap: DAILY_CAP, expiryEpoch: 100000n });

  // ...and grants the connecting wallet read access, so it can verify on Avow.
  await execWithRetry(async () => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::record::add_auditor`,
      arguments: [tx.object(m.accessId), tx.object(m.capId), tx.pure.address(owner)],
    });
    return tx;
  }, kp);

  agents.set(m.mandateId, { kp, accessId: m.accessId, owner });
  saveAgents();
  return { agentAddress: agentAddr, mandateId: m.mandateId };
}

async function agentSuiBalance(agentAddr: string): Promise<number> {
  const b = await sui.getBalance({ owner: agentAddr, coinType: "0x2::sui::SUI" });
  return Number(b.totalBalance) / 1e9;
}

// Without an LLM key, a small parser still pulls the rule out of the prompt: "<amount> <from> to
// <to>". The reasoning it produces is real, just terser; add ANTHROPIC_API_KEY for Claude.
const SYMBOL: Record<string, Token> = {
  sui: "SUI", usdc: "DBUSDC", dbusdc: "DBUSDC", stablecoin: "DBUSDC", usd: "DBUSDC", stable: "DBUSDC",
  usdt: "DBUSDT", dbusdt: "DBUSDT", deep: "DEEP", wal: "WAL", btc: "DBTC", dbtc: "DBTC",
};
function fallbackPlan(instruction: string, _state: unknown): Plan {
  const m = instruction.toLowerCase().match(/([\d.]+)\s*([a-z]+)\s*(?:to|for|into|->|→)\s*([a-z]+)/);
  const amount = m ? Number(m[1]) || 1 : 1;
  const from = (m && SYMBOL[m[2]]) || "SUI";
  const to = (m && SYMBOL[m[3]]) || "DBUSDC";
  return {
    reply: `On it, swapping ${amount} ${from} into ${to}.`,
    understanding: `Swap ${amount} ${from} into ${to}.`,
    constraints: { summary: `exactly ${amount} ${from}, no more`, maxSpend: amount, spendToken: from },
    steps: [{ action: "swap", fromToken: from, toToken: to, amount, why: `the instruction asked to swap ${amount} ${from} to ${to}` }],
    reasoning: {
      goal: `Instruction: "${instruction}"`,
      steps: [
        { kind: "think", title: "Read the instruction", detail: `swap ${amount} ${from} into ${to}` },
        { kind: "decide", title: "Execute exactly what was asked", detail: `${amount} ${from}, no more` },
      ],
      outcome: `Swapped ${amount} ${from} into ${to} on DeepBook.`,
    },
    remember: `Swapped ${amount} ${from} into ${to}.`,
  };
}

interface StepResult {
  actionType: string;
  target: string;
  amount: string; // base units (9 dp), for the on-chain anchor + mandate check
  digest: string;
  spent: number; // amount of the constraint token this step consumed
  summary: string;
}

const toBase = (n: number) => BigInt(Math.round(n * 1e9)).toString();

// Carry out one planned step, enforcing the user's stated spend limit before it acts.
async function executeStep(entry: Agent, addr: string, step: PlanStep, constraints: Plan["constraints"], spent: number): Promise<StepResult | null> {
  const { kp } = entry;
  switch (step.action) {
    case "hold":
      return null;

    case "swap": {
      if (!step.fromToken || !step.toToken) return null;
      let amount = step.amount ?? 0;
      if (amount <= 0) return null;
      // The user's words are the rule: never spend more of the capped token than they authorized.
      if (constraints.maxSpend != null && step.fromToken === constraints.spendToken) {
        amount = Math.min(amount, Math.max(0, constraints.maxSpend - spent));
      }
      if (amount <= 0) throw new Error(`your limit of ${constraints.maxSpend} ${constraints.spendToken} is already used up`);
      const have = await balance(addr, step.fromToken);
      const gasBuffer = step.fromToken === "SUI" ? 0.7 : 0; // leave room for gas + the DEEP bootstrap
      if (have < amount + gasBuffer) throw new Error(`not enough ${step.fromToken} to swap ${amount} (you have ${have.toFixed(2)}); fund the agent a little more`);
      const out = await swap(kp, addr, step.fromToken, step.toToken, amount);
      return {
        actionType: "swap",
        target: `deepbook:${step.fromToken}/${step.toToken}`,
        amount: toBase(amount),
        digest: out.digest,
        spent: step.fromToken === constraints.spendToken ? amount : 0,
        summary: `Swapped ${amount} ${step.fromToken} for ~${out.received.toFixed(4)} ${step.toToken}`,
      };
    }

    case "limit_order": {
      if (!step.pool || !step.side || !step.price || !step.amount) return null;
      const managerId = await ensureManager(entry, addr);
      const [base, quote] = POOL_PAIRS[step.pool] ?? [];
      // A buy rests a bid funded with quote; a sell rests an ask funded with base.
      const coin = step.side === "buy" ? quote : base;
      const need = step.side === "buy" ? step.price * step.amount : step.amount;
      if (coin) await deposit(kp, addr, managerId, coin, need);
      await placeLimit(kp, addr, managerId, step.pool, step.side, step.price, step.amount);
      return {
        actionType: "limit_order",
        target: `deepbook:${step.pool}`,
        amount: toBase(step.amount),
        digest: "",
        spent: 0,
        summary: `Placed a ${step.side} limit for ${step.amount} at ${step.price} on ${step.pool}`,
      };
    }

    case "deposit": {
      if (!step.coin || !step.amount) return null;
      const managerId = await ensureManager(entry, addr);
      await deposit(kp, addr, managerId, step.coin, step.amount);
      return { actionType: "deposit", target: `vault:${step.coin}`, amount: toBase(step.amount), digest: "", spent: 0, summary: `Deposited ${step.amount} ${step.coin} into the trading vault` };
    }

    case "withdraw": {
      if (!step.coin || !step.amount) return null;
      const managerId = await ensureManager(entry, addr);
      await withdraw(kp, addr, managerId, step.coin, step.amount);
      return { actionType: "withdraw", target: `vault:${step.coin}`, amount: toBase(step.amount), digest: "", spent: 0, summary: `Withdrew ${step.amount} ${step.coin} from the trading vault` };
    }

    case "cancel_all": {
      if (!step.pool) return null;
      const managerId = await ensureManager(entry, addr);
      await cancelAll(kp, addr, managerId, step.pool);
      return { actionType: "cancel", target: `deepbook:${step.pool}`, amount: "0", digest: "", spent: 0, summary: `Cancelled all resting orders on ${step.pool}` };
    }
  }
  return null;
}

async function runInstruction(mandateId: string, instruction: string) {
  const entry = agents.get(mandateId);
  if (!entry) throw new Error("unknown agent; claim one first");
  const { kp, accessId, owner } = entry;
  const addr = kp.getPublicKey().toSuiAddress();

  // Read the market, recall long-term memory, and recover this session's conversation, all at once
  // (this parallelism is the biggest latency win). On a fresh start (new login, server restart) the
  // conversation comes back from Walrus, so the agent picks the thread back up.
  //
  // Fast path: an explicit, self-contained swap ("swap 1 SUI to USDC") needs no judgement and no
  // memory, so it skips both the LLM and the slow Walrus recall. Everything else is conversational
  // and gets the agent's full context, its long-term memory plus this session's conversation, so a
  // question like "which of my holdings is up?" actually reaches back to what it bought.
  const explicitSwap = /^\s*(swap|convert)\s+[\d.]+\s+[a-z]+\s+(to|for|into)\s+[a-z]+\s*\.?\s*$/i.test(instruction);
  const cached = conversations.get(mandateId);
  const [snap, tradeFacts, instrFacts, convo] = await Promise.all([
    marketSnapshot(addr),
    // Always pull the trade history with a phrasing the recall reliably matches, so the agent knows
    // its positions however the user asks ("which holding is up?", "should I sell?").
    explicitSwap ? Promise.resolve([] as string[]) : memory.recall(owner, "what did I buy or sell and at what price", 6),
    // Plus anything else this specific instruction reaches for.
    explicitSwap ? Promise.resolve([] as string[]) : memory.recall(owner, instruction, 4),
    cached ? Promise.resolve(cached) : memory.recallConversation(owner, 5),
  ]);
  if (!cached) conversations.set(mandateId, convo);
  const longTerm = Array.from(new Set([...tradeFacts, ...instrFacts]));

  const state = { ...snap, memory: longTerm, conversation: convo.slice(-8) };
  const plan = !hasLLMKey() || explicitSwap ? fallbackPlan(instruction, state) : await makePlan(instruction, state);

  // Execute the steps, enforcing the rule taken from the prompt. A step that can't run (too small,
  // untradeable, limit used up) becomes a plain-language note, not a crash.
  const results: StepResult[] = [];
  const failures: string[] = [];
  let spent = 0;
  for (const step of plan.steps ?? []) {
    try {
      const out = await executeStep(entry, addr, step, plan.constraints, spent);
      if (out) {
        results.push(out);
        spent += out.spent;
      }
    } catch (e) {
      failures.push((e as Error).message);
    }
  }
  // A proof is anchored when the agent acted, or deliberately held (a decision worth proving). A
  // purely conversational turn ("I can't trade that") just talks back, no record.
  const held = !results.length && (plan.steps ?? []).some((s) => s.action === "hold");
  const primary = results[0];
  const url = primary?.digest ? `https://suiscan.xyz/${NETWORK}/tx/${primary.digest}` : "";

  // Talk back: the agent's own words, plus an honest note about anything that couldn't run.
  const reply = failures.length ? `${plan.reply} One thing: ${failures.join("; ")}.` : plan.reply;

  // Update the in-memory conversation now (cheap), then return the reply immediately. The slow part
  // runs in the background: generating the reasoning trace, anchoring the proof on Walrus, and
  // writing memory. By the time the user opens Avow to verify, the record is anchored.
  convo.push({ role: "user", text: instruction }, { role: "agent", text: reply });
  conversations.set(mandateId, convo.slice(-12));
  const note = plan.remember || (results.length ? results.map((x) => x.summary).join("; ") : "");

  void (async () => {
    try {
      if (results.length || held) {
        // The fallback plan already carries its reasoning; the LLM path generates it here, off the
        // user-facing path. This trace is what Avow anchors as the proof of how the agent thought.
        const summaries = results.map((x) => x.summary);
        const trace = plan.reasoning ?? (hasLLMKey() ? await makeReasoning(instruction, plan, summaries) : undefined);
        const r = new Reasoning(trace?.goal || `Instruction: "${instruction}"`);
        for (const s of trace?.steps ?? []) {
          const d = s.detail ?? undefined;
          if (s.kind === "observe") r.observe(s.title, d);
          else if (s.kind === "tool") r.tool(s.title, d);
          else if (s.kind === "decide") r.decide(s.title, d);
          else r.think(s.title, d);
        }
        const outcome = trace?.outcome || summaries.join("; ") || reply;
        const reasoning = r.build(outcome);
        await anchor({
          suiClient: sui, sealClient: seal, walrusClient: walrus, signer: kp, mandateId, accessId,
          bundle: {
            version: EVIDENCE_VERSION, mandateId, agent: addr, user: addr, reasoning,
            actionType: primary?.actionType ?? "hold", target: primary?.target ?? "deepbook", amount: primary?.amount ?? "0",
            rationale: plan.constraints?.summary || outcome,
            observed: { understanding: plan.understanding, constraints: plan.constraints, memory: longTerm, steps: summaries },
            txDigests: results.map((x) => x.digest).filter(Boolean), timestampMs: Date.now(),
          },
        });
      }
      if (note) await memory.remember(owner, note);
      await memory.rememberTurn(owner, { role: "user", text: instruction });
      await memory.rememberTurn(owner, { role: "agent", text: reply });
    } catch (e) {
      console.error("background persist failed:", (e as Error).message);
    }
  })();

  return {
    mandateId, owner, reply, recalled: longTerm.length + convo.length,
    understanding: plan.understanding, constraints: plan.constraints,
    steps: results.map((x) => x.summary), swapUrl: url,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

async function json(req: IncomingMessage) {
  return JSON.parse((await readBody(req)) || "{}");
}

// Lock this to your site in production, e.g. AVOW_CORS_ORIGIN=https://avow.site. Defaults to open
// so local development just works.
const CORS_ORIGIN = process.env.AVOW_CORS_ORIGIN ?? "*";

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", CORS_ORIGIN);
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  const send = (code: number, body: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
  try {
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, platform: platformAddr, claimed: agents.size, llm: hasLLMKey(), memory: memory.enabled });
    if (req.method === "POST" && req.url === "/claim") {
      const { owner } = await json(req);
      if (!owner || !String(owner).startsWith("0x")) return send(400, { error: "connect a wallet first" });
      return send(200, await claim(String(owner)));
    }
    if (req.method === "POST" && req.url === "/my-agent") {
      const { owner } = await json(req);
      return send(200, agentForOwner(String(owner)) ?? { agentAddress: null });
    }
    if (req.method === "POST" && req.url === "/balance") {
      const { agentAddress } = await json(req);
      return send(200, { sui: await agentSuiBalance(String(agentAddress)) });
    }
    if (req.method === "POST" && req.url === "/agent") {
      const { mandateId, instruction } = await json(req);
      return send(200, await runInstruction(String(mandateId), String(instruction ?? "swap 1 SUI")));
    }
    // Developer / admin console endpoints.
    if (req.method === "POST" && req.url === "/dev/mandates") {
      const { owner } = await json(req);
      if (!String(owner).startsWith("0x")) return send(400, { error: "connect a wallet first" });
      return send(200, await devMandates(String(owner)));
    }
    if (req.method === "POST" && req.url === "/dev/grant") {
      const { owner, mandateId, auditor } = await json(req);
      if (!String(auditor).startsWith("0x") || String(auditor).length < 10) return send(400, { error: "give an auditor address (0x...)" });
      return send(200, await devGrant(String(owner), String(mandateId), String(auditor)));
    }
    if (req.method === "POST" && req.url === "/dev/revoke") {
      const { owner, mandateId } = await json(req);
      return send(200, await devRevoke(String(owner), String(mandateId)));
    }
    if (req.method === "POST" && req.url === "/dev/verify") {
      const { owner, mandateId } = await json(req);
      return send(200, await devVerify(String(owner), String(mandateId)));
    }
    if (req.method === "POST" && req.url === "/dev/remember") {
      const { owner, text } = await json(req);
      await memory.remember(String(owner), String(text));
      return send(200, { ok: memory.enabled, stored: String(text) });
    }
    if (req.method === "POST" && req.url === "/dev/recall") {
      const { owner, query } = await json(req);
      return send(200, { results: await memory.recall(String(owner), String(query), 6) });
    }
    return res.writeHead(404).end();
  } catch (e) {
    send(500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`agent server on http://localhost:${PORT}`);
  console.log(`  platform: ${platformAddr}`);
  console.log(`  brain:    ${hasLLMKey() ? "Claude (" + (process.env.AVOW_LLM_MODEL ?? "claude-sonnet-4-6") + " + " + (process.env.AVOW_REASONING_MODEL ?? "claude-haiku-4-5") + " for the proof trace)" : "rule-based (set ANTHROPIC_API_KEY for Claude)"}`);
  console.log(`  memory:   ${memory.enabled ? "MemWal on Walrus — the agent carries its memory across sessions" : "off (set MEMWAL_PRIVATE_KEY + MEMWAL_ACCOUNT_ID)"}`);
  console.log(`  POST /claim { owner }   ->  spins up a personal agent that grants the owner`);
  console.log(`  POST /agent { mandateId, instruction }  ->  plans, trades on DeepBook, proves it`);
});
