import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Section = "overview" | "faq" | "sdk" | "cli";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "faq", label: "FAQ" },
  { id: "sdk", label: "SDK" },
  { id: "cli", label: "CLI" },
];

function CodeBlock({ code, caption }: { code: string; caption?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="doc-code">
      <div className="doc-code-bar">
        <span className="doc-code-cap">{caption ?? "shell"}</span>
        <button className="doc-copy" onClick={copy} aria-label="Copy code">
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function DocMark() {
  return (
    <svg viewBox="0 0 512 512" fill="none" aria-hidden="true" className="doc-mark">
      <path
        d="M150 392 L256 120 L362 392"
        stroke="#5fd08a"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M196 300 L238 342 L322 236"
        stroke="#74e09c"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Docs({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState<Section>("overview");
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Scroll spy: highlight whichever section has reached the top of the scroll area.
  useEffect(() => {
    if (!open) return;
    const root = mainRef.current;
    if (!root) return;
    const onScroll = () => {
      const rootTop = root.getBoundingClientRect().top;
      let current: Section = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = root.querySelector<HTMLElement>(`#doc-${s.id}`);
        if (el && el.getBoundingClientRect().top - rootTop <= 140) current = s.id;
      }
      setActive(current);
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [open]);

  const goTo = (id: Section) => {
    mainRef.current
      ?.querySelector<HTMLElement>(`#doc-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!open) return null;

  return createPortal(
    <div className="doc-overlay" onClick={onClose}>
      <div
        className="doc-shell hud"
        role="dialog"
        aria-modal="true"
        aria-label="Avow documentation"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="doc-head">
          <div className="doc-brand">
            <DocMark />
            <div>
              <span className="doc-brand-mark">avow docs</span>
              <span className="doc-brand-line">proof, not trust</span>
            </div>
          </div>
          <button className="doc-x" onClick={onClose} aria-label="Close documentation">
            ✕
          </button>
        </header>

        <div className="doc-body">
          <nav className="doc-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`doc-nav-btn${active === s.id ? " is-on" : ""}`}
                onClick={() => goTo(s.id)}
              >
                {s.label}
              </button>
            ))}
            <a
              className="doc-nav-ext"
              href="https://github.com/Iziedking/avow"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </nav>

          <main className="doc-main" ref={mainRef}>
            <div id="doc-overview" className="doc-section">
              <Overview onJump={goTo} />
            </div>
            <div id="doc-faq" className="doc-section">
              <Faq />
            </div>
            <div id="doc-sdk" className="doc-section">
              <Sdk />
            </div>
            <div id="doc-cli" className="doc-section">
              <Cli />
            </div>
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Overview({ onJump }: { onJump: (s: Section) => void }) {
  return (
    <article className="doc-article">
      <h2>What Avow is</h2>
      <p className="doc-lead">
        Build agents with the Avow SDK so their actions are stored on Walrus, encrypted with Seal,
        and become verifiable and provable on Sui.
      </p>
      <p>
        Money-moving AI agents ask you to trust their numbers and their judgment. Avow makes them
        prove both. After an agent acts, it seals the evidence, the action <em>and the full
        reasoning behind it</em>, and stamps a tamper-proof anchor on chain. Anyone the agent
        served, or an auditor the owner authorizes, can later decrypt it, recompute its
        fingerprint, and confirm the action was real, inside the rules, and exactly as reasoned.
        Two calls carry the whole product.
      </p>

      <h3>Why this matters</h3>
      <p>
        Agents are turning us from operators into supervisors: they act on our behalf, often
        without asking first. a16z crypto puts the stakes plainly, the moment an agent acts for
        you, <em>"user agency means being able to set boundaries and verify what's done on your
        behalf, even if you're not the one clicking 'sign.'"</em> Without that, delegation is
        just blind trust at scale.
      </p>
      <blockquote className="doc-quote">
        <p>
          "Public ledgers give every transaction a receipt that anyone can audit." Scoped
          delegation frameworks "let users define, at the smart contract level, what an agent can
          and cannot do."
        </p>
        <cite>
          a16z crypto,{" "}
          <a
            href="https://a16zcrypto.com/posts/article/5-ways-blockchains-help-ai-agents/"
            target="_blank"
            rel="noreferrer"
          >
            The missing infrastructure for AI agents
          </a>
        </cite>
      </blockquote>
      <p>
        That is the exact shape of Avow. The <strong>mandate</strong> is the scoped delegation,
        the limits you set on chain. <strong>anchor()</strong> and <strong>verify()</strong> are
        the auditable receipt, proof of what the agent did and why, not a promise. And because
        every record is sealed to the user it served, your agent's reasoning for you stays yours.
        Trust hardcoded into the architecture, not asked for.
      </p>

      <div className="doc-two">
        <div className="doc-card">
          <span className="doc-card-k">on the way in</span>
          <h3>anchor(action)</h3>
          <p>
            Hashes the evidence, the action and its reasoning, sealed to the user it served,
            encrypts it with Seal, stores it on Walrus, and records the anchor on Sui through the
            mandate check. An action that breaks the mandate cannot anchor at all.
          </p>
        </div>
        <div className="doc-card">
          <span className="doc-card-k">on the way out</span>
          <h3>verify(record)</h3>
          <p>
            Reads the blob back, decrypts it for an authorized reader, recomputes the SHA-256,
            and matches it against the on-chain anchor, then confirms the action sat inside the
            mandate.
          </p>
        </div>
      </div>

      <h3>Who's who</h3>
      <p>
        Three roles, which can be one wallet or three. Keeping them straight is the thing most
        people miss.
      </p>
      <div className="doc-two">
        <div className="doc-card">
          <span className="doc-card-k">role</span>
          <h3>Owner</h3>
          <p>
            Creates the mandate and the evidence vault, holds the admin cap, sets the rules,
            grants auditors, can revoke. Allowed to read its own evidence. On the dashboard, the
            wallet you connect is the owner.
          </p>
        </div>
        <div className="doc-card">
          <span className="doc-card-k">role</span>
          <h3>Agent</h3>
          <p>
            The wallet your agent's code signs with. Its address is named in the mandate, and the
            contract lets only that address record actions. This is a key your program holds, not
            a person's wallet.
          </p>
        </div>
        <div className="doc-card">
          <span className="doc-card-k">role</span>
          <h3>Auditor</h3>
          <p>
            Any address the owner grants read access, so they can verify the record without being
            trusted with anything else. Investors, compliance, a user.
          </p>
        </div>
      </div>
      <p className="doc-muted">
        Testing solo? One wallet can be all three: create it, name it as the agent, and it owns
        and reads too. That is the quickest start, just know the roles are really separate.
      </p>

      <h3>The reasoning, captured as it happens</h3>
      <p>
        An action without its reasoning is half a story. As your agent works, it records its
        thinking step by step with the <code>Reasoning</code> builder, what it observed, what it
        weighed, the tools it ran, the decision it reached:
      </p>
      <CodeBlock
        caption="reasoning.ts"
        code={`const r = new Reasoning("Pay this month's Netflix bill if it's safe");
r.observe("Read the bill", "Netflix billed 1599, the usual is 1599");
r.tool("Checked the approved billers", "Netflix is on the list");
r.think("Checked the per-payment limit", "1599 is within the 5000 limit");
r.decide("Approved and paid", "due, approved, matches the usual, within limit");
const reasoning = r.build("Paid Netflix 1599");`}
      />
      <p>
        That whole trace goes into the sealed bundle, so a consumer doesn't read a number, they
        watch the agent think, with the guarantee that nothing was edited after the fact. Avow
        does not read your agent's mind; it proves the agent <strong>committed</strong> to this
        exact reasoning at the time, sealed, attributable, within the rules, and unaltered since.
        Not "trust my reasoning" but "here is the reasoning I committed to, check it yourself."
      </p>
      <p>
        It doesn't matter where the reasoning comes from. A <strong>deterministic</strong> agent
        records its decision path; an <strong>LLM</strong> agent records the model's chain of
        thought, the prompt it ran, the data it acted on. Same call either way. A rule engine and
        a frontier model plug into the exact same layer.
      </p>

      <h3>One agent, many users</h3>
      <p>
        Real agents are shared, one bill payer serving a whole customer base. Avow seals every
        record to the user it served, using Seal's account-based policy: the encryption key
        carries the user's address, so a consumer can replay every decision the agent made{" "}
        <em>for them</em>, and physically cannot open anyone else's. The key servers refuse. No
        per-user setup and no allowlist to maintain, a user's address is their key. The owner can
        still see everything, for support.
      </p>

      <h3>The flow</h3>
      <CodeBlock
        caption="lifecycle"
        code={`agent acts  ->  anchor()
   hash the evidence bundle (reasoning, data used, tx digests)
   seal-encrypt it
   store the ciphertext on Walrus
   record::anchor on Sui, which runs the mandate check

authorized reader  ->  verify()
   read the blob from Walrus
   decrypt with Seal (key servers dry-run seal_approve for the reader)
   recompute the SHA-256
   match it to the on-chain anchor, confirm it was within the mandate`}
      />

      <h3>What the sealed evidence looks like</h3>
      <p>
        The evidence is encrypted before it ever leaves the agent. Open a blob on the Walrus
        aggregator and you see ciphertext, random bytes, not your data:
      </p>
      <CodeBlock
        caption="aggregator.walrus-testnet.walrus.space/v1/blobs/..."
        code={`�c[ «ºŽØÿ2h0¬" }n:T$'b'h$ ¥ÿn(DÜýÙò•°Ì+Ja  èßZÚ^f•G�Cõ'µp±:sÌ³Áæ?Õe sÐ
Ö6â-Ò"£8^1"NÁ¬! åŒ°€b Á¨®ú3^  Ê È'C<4ßŠRðÃ+,ÈMLíÜÃÜw+¹Ðzï0â: dù¤µ¦·  Mvî èÈ¤`}
      />
      <p className="doc-muted">
        That is the privacy guarantee at work. Only a reader the owner added can turn it back into
        readable JSON, and only through <code>verify()</code>. Everyone else sees noise.
      </p>

      <h3>Memory the agent carries everywhere</h3>
      <p>
        The same record is also the agent's <strong>memory</strong>, and it ships in the SDK. One
        call, <code>createMemory()</code>, gives the agent <code>remember()</code> and{" "}
        <code>recall()</code> on Walrus. Before it acts it reads its own history back, so it tracks
        state across sessions instead of starting blank: a trading agent remembers it opened a
        position at one price, and when you later say "sell it for profit", it recalls that entry,
        checks the market, and only sells if it is genuinely up. Log out, log back in, switch
        machines, the context comes with it.
      </p>
      <CodeBlock
        caption="memory.ts"
        code={`import { createMemory } from "avow-sdk";

const memory = createMemory();           // reads MEMWAL_* from the environment

await memory.remember(user, "Bought 0.3 WAL at 0.71 SUI.");
const context = await memory.recall(user, "what's my WAL position?");`}
      />
      <p className="doc-muted">
        Memory runs on <strong>MemWal (Walrus Memory)</strong>, scoped per user; proof runs on our
        Seal-anchored evidence log. MemWal for what the agent remembers, Avow for proving what it
        did, both come from <code>avow-sdk</code>, both live on Walrus, neither locked to this app.
      </p>

      <div className="doc-jump">
        <button className="doc-pill" onClick={() => onJump("sdk")}>
          Integrate with the SDK →
        </button>
        <button className="doc-pill" onClick={() => onJump("cli")}>
          Use the command line →
        </button>
      </div>
    </article>
  );
}

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "What is Avow?",
    a: (
      <>
        Avow is a verifiable trust and memory layer for AI agents. Build your agent with the Avow
        SDK, and every action it takes, <em>and the reasoning behind it</em>, is sealed with Seal,
        stored on Walrus, and anchored on Sui. Anyone you authorize can later replay exactly what
        the agent did, why it did it, and confirm it stayed inside the rules you set. Proof, not
        trust.
      </>
    ),
  },
  {
    q: "What can Avow do?",
    a: (
      <>
        It proves an agent's actions are correct and within your limits, an action that broke your
        rules could never have been recorded in the first place. It stores every action and its full
        reasoning durably on Walrus, encrypted per user with Seal. It gives the agent verifiable{" "}
        <strong>memory</strong> it reads and builds on across sessions. And one shared agent can
        serve many people, each decrypting only their own history, nobody else's.
      </>
    ),
  },
  {
    q: "How do I use it?",
    a: (
      <>
        Two calls. After your agent acts, call <code>anchor(action)</code>; to check a record, call{" "}
        <code>verify(record)</code>. Set a <strong>mandate</strong> first, the rules (per-action and
        daily caps, expiry, the agent's address), and the contract only records actions inside it.
        Prefer no code? Use the CLI, or the live console: connect a wallet, claim a DeepBook agent,
        fund it, and instruct it in plain English.
      </>
    ),
  },
  {
    q: "How does it help shape my AI agent?",
    a: (
      <>
        Once an agent is built with the Avow SDK, its correctness becomes <strong>provable</strong>.
        Every action is stored and follows the agent everywhere, portable, not locked to one app or
        model, and anyone you authorize can verify it independently. The agent also gains memory on
        Walrus, so it remembers what it did and builds on it over time. Trust turns into proof, and
        your agent gets a durable, portable spine it carries with it.
      </>
    ),
  },
  {
    q: "Is my agent's data private?",
    a: (
      <>
        Yes. Evidence is encrypted with Seal before it ever leaves the agent and stored as
        ciphertext on Walrus, open a blob and you see random bytes. Only a reader the owner
        authorized can decrypt it, enforced on chain by the Seal key servers. On a shared agent each
        user's address is their key: they read their own records and physically cannot open anyone
        else's.
      </>
    ),
  },
  {
    q: "Does it work with any agent?",
    a: (
      <>
        Any agent, any domain. A <strong>deterministic</strong> rule engine records its decision
        path; an <strong>LLM</strong> agent records the model's chain of thought and the data it
        acted on. The same <code>anchor()</code> and <code>verify()</code> either way. Finance,
        productivity, gaming, if it acts, Avow can prove it.
      </>
    ),
  },
];

function Faq() {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <article className="doc-article">
      <h2>FAQ</h2>
      <div className="faq-list">
        {FAQS.map((f, i) => {
          const isOpen = open.has(i);
          return (
            <div key={i} className={`faq-item${isOpen ? " is-open" : ""}`}>
              <button className="faq-q" onClick={() => toggle(i)} aria-expanded={isOpen}>
                <span className="faq-q-text">{f.q}</span>
                <span className="faq-plus" aria-hidden />
              </button>
              <div className="faq-a">
                <div className="faq-a-inner">
                  <p>{f.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function Sdk() {
  return (
    <article className="doc-article">
      <h2>Build an agent with the SDK</h2>
      <p>
        <code>avow-sdk</code> turns any agent — a new one, or one you already run — into a stateful,
        verifiable one. Two halves, one install: <strong>memory</strong> it carries everywhere
        (<code>createMemory</code>), and <strong>proof</strong> of everything it did and why
        (<code>anchor</code> / <code>verify</code>). Your model and tools stay yours; Avow wraps the
        memory and the proof around them. Plain TypeScript, nothing to stand up.
      </p>

      <CodeBlock caption="install" code={`npm i avow-sdk`} />

      <h3>1 · Set the mandate (once)</h3>
      <p>
        The owner mints a mandate — the agent's rules — and an access object, the sealed space its
        evidence lives in. <code>createMandate</code> does both and returns their ids.
      </p>
      <CodeBlock
        caption="setup.ts"
        code={`import { getSuiClient, createMandate } from "avow-sdk";

const sui = getSuiClient();
const created = await createMandate(sui, ownerKeypair, {
  agent: agentAddress,        // the only address allowed to anchor
  perMoveCap: 1_000_000n,     // most it can move per action
  dailyCap: 10_000_000n,      // most it can move per epoch
  expiryEpoch: 100_000n,      // when the mandate stops working
});

// created.mandateId   the rulebook
// created.accessId    the evidence vault
// created.capId       the owner cap, keep it safe`}
      />

      <h3>2 · Give it memory it carries everywhere</h3>
      <p>
        One call, <code>createMemory()</code>, and the agent remembers across sessions — log out,
        log back in, move to another machine, and the context follows it, on Walrus, scoped per
        user. Recall before it acts; remember after, so it builds over time. Memory is a no-op until
        you set <code>MEMWAL_PRIVATE_KEY</code> and <code>MEMWAL_ACCOUNT_ID</code> (from
        memory.walrus.xyz), so the same code runs with or without it.
      </p>
      <CodeBlock
        caption="memory.ts"
        code={`import { createMemory } from "avow-sdk";

const memory = createMemory();   // reads MEMWAL_PRIVATE_KEY + MEMWAL_ACCOUNT_ID

// before acting, pull back what's relevant — even after logout, on another machine
const context = await memory.recall(user, "what's my position, what did I buy?");
// -> ["Bought 0.3 WAL at 0.71 SUI.", ...]

// after acting, remember it so the next run builds on it
await memory.remember(user, "Bought 0.3 WAL at 0.71 SUI.");`}
      />

      <h3>3 · Capture the reasoning, anchor the proof</h3>
      <p>
        After the agent acts, the whole integration is one call. The clients are the connections to
        Sui, Seal, and Walrus; <code>signer</code> is the agent key; <code>bundle</code> is the
        evidence, with the reasoning trace inside it.
      </p>
      <CodeBlock
        caption="anchor.ts"
        code={`import {
  getSuiClient, getSealClient, getWalrusClient,
  anchor, Reasoning, EVIDENCE_VERSION,
} from "avow-sdk";

const sui = getSuiClient();

// capture the reasoning as the agent works
const reasoning = new Reasoning("Pay the invoice the user approved")
  .observe("Read the invoice", "Stripe inv_42 for 1500")
  .decide("Approved and paid", "the user pre-approved this invoice")
  .build("Paid Stripe 1500");

const proof = await anchor({
  suiClient: sui,
  sealClient: getSealClient(sui),
  walrusClient: getWalrusClient(sui),
  signer: agentKeypair,        // the agent's key
  mandateId,                   // the rulebook
  accessId,                    // the evidence vault
  bundle: {
    version: EVIDENCE_VERSION,
    mandateId,
    agent: agentAddress,
    user: customerAddress,     // sealed to this user; on a shared agent only they can read it
    reasoning,                 // the full reasoning trace
    actionType: "payment",     // what it did
    target: "stripe",          // who it acted on
    amount: "1500",            // how much it moved
    rationale: "Paid the invoice the user approved.",
    observed: { invoiceId: "inv_42" },  // the data it saw
    before: {},
    after: {},
    txDigests: [actionDigest],          // the real transfer id
    timestampMs: Date.now(),
  },
});

// proof.blobId           where the sealed evidence lives on Walrus
// proof.evidenceHashHex  the fingerprint stamped on chain
// proof.anchorDigest     the Sui transaction that anchored it`}
      />

      <h3>4 · Verify — anyone with access, trustlessly</h3>
      <p>
        Reading is the reverse. <code>listRecords</code> gives you the anchored records,{" "}
        <code>createSession</code> proves who you are to the Seal key servers, and{" "}
        <code>verify</code> decrypts and checks one record.
      </p>
      <CodeBlock
        caption="verify.ts"
        code={`import {
  getSuiClient, getSealClient, getWalrusClient,
  listRecords, createSession, verify,
} from "avow-sdk";

const sui = getSuiClient();
const records = await listRecords(sui, mandateId);
const session = await createSession(sui, readerKeypair);

const result = await verify({
  suiClient: sui,
  sealClient: getSealClient(sui),
  walrusClient: getWalrusClient(sui),
  sessionKey: session,
  record: records[0],
});

// result.hashMatches     evidence is unaltered since it was anchored
// result.amountMatches   the anchored amount matches the evidence
// result.withinMandate   the action sat inside the declared limits
// result.bundle          the decrypted evidence, readable JSON`}
      />

      <h3>5 · The whole loop</h3>
      <p>
        Put together, every turn the agent recalls, decides, acts, proves, and remembers. That is an
        Avow agent: stateful and provable, end to end — and the model and tools in the middle are
        still entirely yours.
      </p>
      <CodeBlock
        caption="agent.ts"
        code={`// each turn the agent runs:
const context = await memory.recall(user, instruction);    // 1. remember the past
const plan    = await yourModel(instruction, context);     // 2. decide — your agent, your model
const digest  = await plan.execute();                      // 3. act for real

await anchor({ suiClient, sealClient, walrusClient, signer: agent,
  mandateId, accessId,
  bundle: { ...plan.evidence, txDigests: [digest] } });    // 4. prove it, sealed on Walrus

await memory.remember(user, plan.summary);                 // 5. remember it, on Walrus`}
      />
      <p className="doc-muted">
        Drop these into a fresh agent or wrap one you already run. Everything an agent does this way
        is the same <code>anchor()</code> / <code>verify()</code> the CLI and this dashboard use, so
        a proof made in code verifies in the browser, and the other way around.
      </p>
    </article>
  );
}

function Cli() {
  return (
    <article className="doc-article">
      <h2>CLI</h2>
      <p>
        Everything the SDK does is also a terminal command, through <code>avow-cli</code>. No code
        required. Install it once and the <code>avow</code> command is everywhere.
      </p>
      <CodeBlock caption="install" code={`npm i -g avow-cli`} />

      <h3>Two settings it needs</h3>
      <p>
        Your key signs transactions and decrypts evidence you are allowed to read. Use a throwaway
        testnet key. The network defaults to testnet.
      </p>
      <CodeBlock
        caption="auth"
        code={`export AVOW_KEY=suiprivkey1...   # your Sui private key, or pass --key
export AVOW_NETWORK=testnet      # the default, set mainnet to switch`}
      />

      <h3>Write the rulebook</h3>
      <p>You, the owner, set what the agent may do. It prints back the ids you reuse below.</p>
      <CodeBlock
        caption="create-mandate"
        code={`avow create-mandate --agent 0xAGENT --per-move 1000000 --daily 10000000

# prints AVOW_MANDATE_ID, AVOW_ACCESS_ID, and an admin cap to keep safe
export AVOW_MANDATE_ID=0x...  AVOW_ACCESS_ID=0x...`}
      />

      <h3>Log an action, and prove it</h3>
      <p>Run as the agent. A move that breaks the mandate will not anchor at all.</p>
      <CodeBlock
        caption="anchor"
        code={`avow anchor --mandate $AVOW_MANDATE_ID --access $AVOW_ACCESS_ID \\
  --action payment --target stripe --amount 1500 \\
  --rationale "paid the approved invoice"`}
      />

      <h3>Show the logbook</h3>
      <p>Read-only, no key required. Anyone can see what was anchored.</p>
      <CodeBlock caption="records" code={`avow records --mandate $AVOW_MANDATE_ID`} />

      <h3>Open the receipts and check them</h3>
      <p>
        The point of Avow. Decrypts each record (if your key is authorized), recomputes the hash,
        confirms it was within the mandate, and prints ok or FAIL with a final tally.
      </p>
      <CodeBlock caption="verify" code={`avow verify --mandate $AVOW_MANDATE_ID`} />

      <p className="doc-muted">
        The CLI is the same <code>anchor()</code> and <code>verify()</code> the SDK and this
        dashboard use, so a record anchored from the terminal verifies in the browser, and back.
      </p>
    </article>
  );
}
