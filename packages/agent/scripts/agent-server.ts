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
import { readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";
import {
  getSuiClient, getSealClient, getWalrusClient, createMandate, anchor, Reasoning,
  EVIDENCE_VERSION, PACKAGE_ID, NETWORK,
} from "avow-sdk";

const POOL = "SUI_DBUSDC";
const DEEP_TYPE = "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP";
const WAL_TYPE = "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL";
const PORT = Number(process.env.AGENT_PORT ?? 8787);
const PER_MOVE_CAP = 5_000_000_000n; // 5 SUI per action
const DAILY_CAP = 50_000_000_000n;

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

// Claimed agents this session: mandateId -> { keypair, accessId, owner }
const agents = new Map<string, { kp: Ed25519Keypair; accessId: string; owner: string }>();

// Sign + execute, retrying on transient gas-object version races (the SDK asks to "rebuild").
async function execWithRetry(build: () => Promise<Transaction>, signer: Ed25519Keypair, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await sui.signAndExecuteTransaction({ transaction: await build(), signer });
      await sui.waitForTransaction({ digest: res.digest });
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

// Fund a fresh agent with gas SUI + WAL (storage) in one atomic tx; DEEP it bootstraps from SUI.
async function fundPlumbing(agentAddr: string) {
  await execWithRetry(async () => {
    const wal = await sui.getCoins({ owner: platformAddr, coinType: WAL_TYPE });
    if (!wal.data.length) throw new Error("platform has no WAL");
    const tx = new Transaction();
    const [gas] = tx.splitCoins(tx.gas, [600_000_000]); // 0.6 SUI: gas + DEEP bootstrap
    const walPrimary = tx.object(wal.data[0].coinObjectId);
    if (wal.data.length > 1) tx.mergeCoins(walPrimary, wal.data.slice(1).map((c) => tx.object(c.coinObjectId)));
    const [walPart] = tx.splitCoins(walPrimary, [40_000_000]); // 0.04 WAL
    tx.transferObjects([gas, walPart], agentAddr);
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
  return { agentAddress: agentAddr, mandateId: m.mandateId };
}

async function agentSuiBalance(agentAddr: string): Promise<number> {
  const b = await sui.getBalance({ owner: agentAddr, coinType: "0x2::sui::SUI" });
  return Number(b.totalBalance) / 1e9;
}

function interpret(text: string): { amountSui: number } {
  const m = text.toLowerCase().match(/([\d]+(?:\.[\d]+)?)\s*sui/);
  return { amountSui: m ? Math.max(1, Math.round(Number(m[1]) * 10) / 10) : 1 };
}

async function ensureDeep(db: DeepBookClient, kp: Ed25519Keypair, addr: string) {
  const bal = await sui.getBalance({ owner: addr, coinType: DEEP_TYPE });
  if (Number(bal.totalBalance) >= 1_000_000) return;
  // Buy well above the DEEP_SUI pool's 10-DEEP minSize so it fills even if the price moved.
  await execWithRetry(async () => {
    const t = new Transaction();
    const [b, q, d] = t.add(db.deepBook.swapExactQuoteForBase({ poolKey: "DEEP_SUI", amount: 0.5, deepAmount: 0, minOut: 0, payWithDeep: false }));
    t.transferObjects([b, q, d], addr);
    return t;
  }, kp);
  const after = await sui.getBalance({ owner: addr, coinType: DEEP_TYPE });
  if (Number(after.totalBalance) < 1_000_000) throw new Error("could not get DEEP for fees (DeepBook pool too thin right now)");
}

async function runInstruction(mandateId: string, instruction: string) {
  const entry = agents.get(mandateId);
  if (!entry) throw new Error("unknown agent; claim one first");
  const { kp, accessId, owner } = entry;
  const addr = kp.getPublicKey().toSuiAddress();
  const db = new DeepBookClient({ client: sui as never, address: addr, network: "testnet" });
  const { amountSui } = interpret(instruction);

  if ((await agentSuiBalance(addr)) < amountSui + 0.2) throw new Error(`fund the agent first: it needs ~${amountSui + 0.2} SUI`);
  await ensureDeep(db, kp, addr);

  const mid = await db.midPrice(POOL);
  const quote = await db.getQuoteQuantityOut(POOL, amountSui);

  const r = new Reasoning(`Instruction: "${instruction}"`);
  r.observe("Read the DeepBook SUI/DBUSDC market", `mid price ${mid.toFixed(4)} DBUSDC per SUI`, { mid });
  r.think("Interpreted the instruction", `swap ${amountSui} SUI to DBUSDC stablecoin`);
  r.tool("Quoted the swap on DeepBook", `~${quote.quoteOut.toFixed(4)} DBUSDC out`, quote);
  r.think("Checked the mandate limits", `${amountSui} SUI is within the per-action cap`);
  r.decide("Execute the swap on DeepBook", `take ~${quote.quoteOut.toFixed(4)} DBUSDC`);
  const reasoning = r.build(`Swapped ${amountSui} SUI for ~${quote.quoteOut.toFixed(4)} DBUSDC on DeepBook`);

  const res = await execWithRetry(async () => {
    const tx = new Transaction();
    const [b, q, d] = tx.add(db.deepBook.swapExactBaseForQuote({ poolKey: POOL, amount: amountSui, deepAmount: quote.deepRequired, minOut: 0 }));
    tx.transferObjects([b, q, d], addr);
    return tx;
  }, kp);
  if (!res) throw new Error("swap did not execute");

  await anchor({
    suiClient: sui, sealClient: seal, walrusClient: walrus, signer: kp, mandateId, accessId,
    bundle: {
      version: EVIDENCE_VERSION, mandateId, agent: addr, user: addr, reasoning,
      actionType: "swap", target: "deepbook:SUI/DBUSDC", amount: BigInt(Math.round(amountSui * 1e9)).toString(),
      rationale: reasoning.outcome, observed: { mid, quote }, txDigests: [res.digest], timestampMs: Date.now(),
    },
  });

  return { mandateId, owner, reasoning, swapDigest: res.digest, swapUrl: `https://suiscan.xyz/${NETWORK}/tx/${res.digest}` };
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

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  const send = (code: number, body: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
  try {
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, platform: platformAddr, claimed: agents.size });
    if (req.method === "POST" && req.url === "/claim") {
      const { owner } = await json(req);
      if (!owner || !String(owner).startsWith("0x")) return send(400, { error: "connect a wallet first" });
      return send(200, await claim(String(owner)));
    }
    if (req.method === "POST" && req.url === "/balance") {
      const { agentAddress } = await json(req);
      return send(200, { sui: await agentSuiBalance(String(agentAddress)) });
    }
    if (req.method === "POST" && req.url === "/agent") {
      const { mandateId, instruction } = await json(req);
      return send(200, await runInstruction(String(mandateId), String(instruction ?? "swap 1 SUI")));
    }
    return res.writeHead(404).end();
  } catch (e) {
    send(500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`agent server on http://localhost:${PORT}`);
  console.log(`  platform: ${platformAddr}`);
  console.log(`  POST /claim { owner }  ->  spins up a personal agent that grants the owner`);
  console.log(`  POST /agent { mandateId, instruction }`);
});
