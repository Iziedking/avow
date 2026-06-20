// The developer / admin console (served at ?dev): a terminal where an owner administers the
// mandates it claimed and exercises the Avow SDK live — grant an auditor, revoke a mandate, verify
// a proof end to end, remember and recall on Walrus. Same computer-screen aesthetic as the agent
// console, the admin side of it. Admin actions are signed server-side by the mandate's agent cap,
// on the connecting wallet's authority.

import { useEffect, useRef, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { beep } from "./beep";
import { WalletConnect } from "./WalletConnect";

const AGENT_API =
  (import.meta.env.VITE_AGENT_API as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8787";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sc = (digest: string) => `https://suiscan.xyz/testnet/tx/${digest}`;

type Kind = "out" | "ok" | "err" | "code" | "head" | "dim" | "step";
interface Line {
  kind: Kind | "cmd";
  text: string;
  href?: string;
}
interface MandateRow {
  mandateId: string;
  agentAddress: string;
  revoked?: boolean;
  records?: number;
  flagged?: number;
}

const HELP: [string, string][] = [
  ["demo", "run the full CLI flow live: create, anchor, records, verify"],
  ["mandates", "list the mandates you own (numbered)"],
  ["grant <0xauditor> [#]", "give a wallet read access to mandate #"],
  ["revoke <#>", "revoke a mandate, the agent can no longer act"],
  ["verify [#]", "verify the latest proof for mandate # (Walrus + Seal)"],
  ["remember <text>", "store a memory on Walrus"],
  ["recall <query>", "recall from memory, by meaning"],
  ["sdk", "show how to call the Avow SDK"],
  ["whoami", "the wallet you're acting as"],
  ["clear", "clear the screen"],
];

// Plain text (no backticks) so it renders cleanly in the terminal.
const SDK_REFERENCE = `Avow SDK — proof + memory for an AI agent, on Walrus.

  import { createMandate, anchor, verify, createMemory, listRecords } from "avow-sdk";

  1. createMandate(sui, owner, { agent, perMoveCap, dailyCap, expiryEpoch })
       sets what the agent may do, opens a sealed evidence space. Returns mandateId, accessId, capId.

  2. record::add_auditor(access, cap, auditor)        <- this console's  grant
       gives a wallet read access to the evidence.

  3. anchor({ suiClient, sealClient, walrusClient, signer: agent, mandateId, accessId, bundle })
       the agent's action + reasoning, sealed on Walrus, anchored on Sui.

  4. const records = await listRecords(sui, mandateId)
     verify({ suiClient, sealClient, walrusClient, sessionKey, record: records[0] })
       decrypt, recompute the hash, confirm it sits within the mandate.   <- this console's  verify

  5. const memory = createMemory()
     await memory.remember(user, "Bought 0.3 WAL at 0.71.")
     await memory.recall(user, "my WAL position")     <- this console's  remember / recall

  Two halves, one SDK: anchor()/verify() prove what an agent did; createMemory() gives it a
  portable brain it carries across sessions. Both live on Walrus.`;

export function DevConsole() {
  const account = useCurrentAccount();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);
  const mandatesRef = useRef<MandateRow[]>([]);
  const lastMandateRef = useRef<string | null>(null); // the mandate `demo` just made, so grant/verify default to it

  const add = (kind: Line["kind"], text: string, href?: string) => {
    setLines((ls) => [...ls, { kind, text, href }]);
    beep(kind === "err" ? 300 : kind === "ok" ? 880 : 600);
  };
  const api = async (path: string, body: unknown) =>
    (await fetch(`${AGENT_API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, queue, busy]);

  useEffect(() => {
    setLines([]);
    setQueue([]);
    mandatesRef.current = [];
  }, [account?.address]);

  function submit() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setQueue((q) => [...q, text]);
  }

  // Drain one command at a time; the input stays live so you can type ahead, like a real shell.
  useEffect(() => {
    if (processingRef.current || queue.length === 0) return;
    processingRef.current = true;
    setBusy(true);
    const raw = queue[0];
    (async () => {
      add("cmd", raw);
      try {
        await run(raw);
      } catch (e) {
        add("err", (e as Error).message || "command failed");
      } finally {
        setQueue((q) => q.slice(1));
        setBusy(false);
        processingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  async function loadMandates(owner: string): Promise<MandateRow[]> {
    const r = await api("/dev/mandates", { owner });
    if (r.error) throw new Error(r.error);
    mandatesRef.current = (r.mandates as MandateRow[]) ?? [];
    return mandatesRef.current;
  }

  async function pickMandate(owner: string, idx: number): Promise<MandateRow | null> {
    if (!mandatesRef.current.length) await loadMandates(owner);
    const m = mandatesRef.current[idx];
    if (!m) {
      add("err", `no mandate [${idx + 1}] — run "mandates" to list them`);
      return null;
    }
    return m;
  }

  // Resolve which mandate a command targets: an explicit number wins; otherwise the one `demo` just
  // created; otherwise the first in the list. Lets "grant 0x.." and "verify" work right after "demo".
  async function resolveMandate(owner: string, num?: string): Promise<MandateRow | null> {
    if (num) return pickMandate(owner, Number(num) - 1);
    if (lastMandateRef.current) return { mandateId: lastMandateRef.current, agentAddress: "" };
    return pickMandate(owner, 0);
  }

  async function run(raw: string) {
    const [cmd, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(" ");
    const c = cmd.toLowerCase();
    const owner = account?.address;

    if (c === "help" || c === "?") {
      add("head", "commands");
      for (const [name, desc] of HELP) add("out", `  ${name.padEnd(24)} ${desc}`);
      return;
    }
    if (c === "sdk") {
      add("head", "the Avow SDK");
      for (const l of SDK_REFERENCE.split("\n")) add("code", l || " ");
      return;
    }
    if (c === "clear" || c === "cls") return setLines([]);
    if (!owner) return add("err", "connect your admin wallet first");

    switch (c) {
      case "whoami":
        return add("out", `acting as ${owner}`);

      case "demo": {
        // The whole developer flow, live, in one command. Mirrors the avow CLI.
        add("head", "the full developer flow, live");
        add("dim", "create a mandate, seal an action on Walrus, anchor it on Sui, then verify it");
        add("dim", "running… real transactions plus Walrus and Seal, give it a moment");
        const r = await api("/dev/demo", { owner });
        if (r.error) return add("err", r.error);
        lastMandateRef.current = r.mandateId; // grant/verify with no number now target this mandate
        await sleep(150);
        add("step", `$ avow create-mandate --agent ${short(r.agent)} --per-move ${r.perMove} --daily 100000`);
        await sleep(200);
        add("ok", `mandate ${short(r.mandateId)}   ·   access ${short(r.accessId)}`);
        await sleep(350);
        add("step", `$ avow anchor --mandate ${short(r.mandateId)} --action payment --target stripe --amount ${r.amount} --rationale "paid the approved invoice"`);
        await sleep(200);
        add("ok", `sealed on Walrus (blob ${short(r.blobId)})  ·  anchored on Sui`);
        await sleep(150);
        add("out", `proof tx ${short(r.anchorDigest)} ↗`, sc(r.anchorDigest));
        await sleep(350);
        add("step", `$ avow records --mandate ${short(r.mandateId)}`);
        await sleep(200);
        add("out", `payment  ->  stripe  ${r.amount}`);
        await sleep(350);
        add("step", `$ avow verify --mandate ${short(r.mandateId)}`);
        await sleep(200);
        const within = r.verify?.withinMandate;
        const intact = r.verify?.hashMatches && r.verify?.amountMatches;
        add(
          intact && within ? "ok" : "err",
          `${intact ? "✓ intact" : "✗ tampered"}  ·  ${within ? "within rules" : "OUT OF BOUNDS: " + (r.verify?.breachLabels ?? []).join(", ")}   "${r.rationale}"`,
        );
        await sleep(200);
        add("dim", "that is the whole flow: an action sealed, anchored, and verified on chain. two SDK calls.");
        await sleep(250);
        add("head", "verify it yourself on the Avow home");
        add("out", `mandate ${r.mandateId}`);
        add("out", "open it on the home and verify ↗", `/?app&mandate=${r.mandateId}`);
        await sleep(200);
        add("dim", "or grant an auditor: type  grant 0xTHEIR_WALLET  then they verify it with their own wallet.");
        return;
      }

      case "mandates":
      case "ls": {
        const ms = await loadMandates(owner);
        if (!ms.length) return add("out", 'no mandates yet — claim an agent in the console (/?console) first.');
        add("head", `${ms.length} mandate(s) you administer`);
        ms.forEach((m, i) => {
          const status = m.revoked
            ? "REVOKED"
            : `${m.records ?? 0} proofs${m.flagged ? ` · ${m.flagged} flagged` : ""}`;
          add(m.revoked || m.flagged ? "dim" : "ok", `  [${i + 1}] ${short(m.mandateId)}   agent ${short(m.agentAddress)}   ${status}`);
        });
        return;
      }

      case "grant": {
        const parts = arg.split(/\s+/).filter(Boolean);
        const auditor = parts[0];
        if (!auditor || !auditor.startsWith("0x")) return add("err", "usage: grant <0xauditor> [#]");
        const m = await resolveMandate(owner, parts[1]);
        if (!m) return;
        add("dim", `record::add_auditor — granting ${short(auditor)} read access to ${short(m.mandateId)}…`);
        const r = await api("/dev/grant", { owner, mandateId: m.mandateId, auditor });
        if (r.error) return add("err", r.error);
        add("ok", `granted — ${short(auditor)} can now verify this mandate's proofs on Avow`);
        return add("out", `tx ${short(r.digest)} ↗`, `https://suiscan.xyz/testnet/tx/${r.digest}`);
      }

      case "revoke": {
        const m = await resolveMandate(owner, arg);
        if (!m) return;
        add("dim", `mandate::revoke — revoking ${short(m.mandateId)}…`);
        const r = await api("/dev/revoke", { owner, mandateId: m.mandateId });
        if (r.error) return add("err", r.error);
        add("ok", "revoked — the agent can no longer act under this mandate");
        return add("out", `tx ${short(r.digest)} ↗`, `https://suiscan.xyz/testnet/tx/${r.digest}`);
      }

      case "verify": {
        const m = await resolveMandate(owner, arg);
        if (!m) return;
        add("dim", "reading from Walrus · decrypting via Seal · recomputing the hash…");
        const r = await api("/dev/verify", { owner, mandateId: m.mandateId });
        if (r.error) return add("err", r.error);
        const intact = r.result.hashMatches && r.result.amountMatches;
        add(intact ? "ok" : "err", `${intact ? "✓ intact" : "✗ TAMPERED"} — sealed evidence matches the hash anchored on chain`);
        if (r.result.withinMandate) add("ok", "✓ within rules — the action stayed inside the mandate");
        else add("err", `⚠ OUT OF BOUNDS — ${(r.result.breachLabels ?? []).join(", ")}`);
        add("out", `action: ${r.record.actionType} ${r.record.amount !== "0" ? r.record.amount : ""} on ${r.record.target}`);
        if (r.goal) add("out", `decrypted goal: ${r.goal}`);
        (r.steps ?? []).forEach((s: string) => add("dim", `  · ${s}`));
        if (r.rationale) add("out", `rationale: ${r.rationale}`);
        return;
      }

      case "remember": {
        if (!arg) return add("err", "usage: remember <text>");
        add("dim", "writing to Walrus memory…");
        const r = await api("/dev/remember", { owner, text: arg });
        return add(r.ok ? "ok" : "err", r.ok ? `remembered: ${arg}` : "memory is off (set MEMWAL_PRIVATE_KEY + MEMWAL_ACCOUNT_ID)");
      }

      case "recall": {
        if (!arg) return add("err", "usage: recall <query>");
        add("dim", "recalling by meaning from Walrus…");
        const r = await api("/dev/recall", { owner, query: arg });
        if (!r.results?.length) return add("out", "nothing relevant in memory yet.");
        add("head", `recalled ${r.results.length}`);
        return (r.results as string[]).forEach((x) => add("out", `  • ${x}`));
      }

      default:
        return add("err", `unknown command: ${cmd} — type "help"`);
    }
  }

  const ps = account ? `${short(account.address)}@avow` : "guest@avow";

  return (
    <div className="ac">
      <div className="ac-screen hud">
        <div className="ac-bar">
          <div className="ac-bar-left">
            <a className="ac-home" href="/?app">‹ home</a>
            <span>AVOW · DEVELOPER CONSOLE</span>
          </div>
          <div className="ac-bar-right">
            <span>{busy ? "working" : account ? "admin" : "no wallet"}</span>
            <WalletConnect />
          </div>
        </div>

        <div className="ac-log" ref={logRef}>
          {lines.length === 0 && (
            <div className="ac-idle">
              <p>{"> Avow developer console — administer your mandates and exercise the SDK."}</p>
              <p className="ac-dim">{'> type "help" for commands, or "sdk" to see how Avow is called.'}</p>
            </div>
          )}
          {lines.map((l, i) =>
            l.href ? (
              <a key={i} className="ac-line dc-link ac-anchor" href={l.href} target="_blank" rel="noreferrer">
                {l.text}
              </a>
            ) : l.kind === "cmd" ? (
              <div key={i} className="ac-line ac-cmd">
                <span className="ac-cmd-ps">{ps}:~$</span>
                <span className="ac-cmd-text">{l.text}</span>
              </div>
            ) : (
              <div key={i} className={`ac-line dc-${l.kind}`}>
                {l.text}
              </div>
            ),
          )}
          {busy && (
            <div className="ac-working">
              <span className="ac-work-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          {queue.slice(busy ? 1 : 0).map((q, i) => (
            <div key={`q-${i}`} className="ac-line ac-queued">
              <span className="ac-cmd-ps">{ps}:~$</span>
              <span className="ac-queued-text">{q}</span>
              <span className="ac-queued-tag">queued</span>
            </div>
          ))}
        </div>

        <form
          className="ac-prompt"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <span className="ac-ps1">{ps}:~$</span>
          <input
            className="ac-input"
            value={input}
            placeholder={account ? "type a command — help, mandates, grant, verify, sdk…" : "connect your admin wallet to begin"}
            spellCheck={false}
            autoFocus
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="ac-run" type="submit" disabled={!input.trim()}>
            run ▸
          </button>
        </form>
      </div>

      <div className="ac-foot">
        <span className="ac-dim">admin actions are signed by the mandate's agent cap, on your wallet's authority · testnet</span>
      </div>
    </div>
  );
}
