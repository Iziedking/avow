import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Section = "overview" | "sdk" | "cli";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sdk", label: "SDK" },
  { id: "cli", label: "Command line" },
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
      <p>
        Money-moving AI agents ask you to trust their numbers. Avow makes them prove them. After
        an agent acts, it seals the evidence and stamps a tamper-proof anchor on chain. Anyone the
        owner authorizes can later decrypt that evidence, recompute its fingerprint, and confirm
        the action was real and inside the rules. Two calls carry the whole product.
      </p>

      <div className="doc-two">
        <div className="doc-card">
          <span className="doc-card-k">on the way in</span>
          <h3>anchor(action)</h3>
          <p>
            Hashes the evidence, encrypts it with Seal, stores the ciphertext on Walrus, and
            records the anchor on Sui through the mandate check. An action that breaks the
            mandate cannot anchor at all.
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

      <h3>Where the reasoning comes from</h3>
      <p>
        Avow does not read your agent's mind. The wallet is only identity. The reasoning is
        whatever your code puts in the evidence bundle: <code>rationale</code> for the why,{" "}
        <code>observed</code> for the data it saw, <code>txDigests</code> for the real
        transactions. For an LLM agent, you drop the model's prompt and output into{" "}
        <code>rationale</code> and the data it was fed into <code>observed</code>, then call{" "}
        <code>anchor()</code>. Avow seals and proves exactly what you record.
      </p>
      <p>
        So it proves the agent <strong>committed</strong> to this reasoning at the time, sealed,
        attributable, within the rules, and provably unaltered since. It does not prove the model
        "truly thought" it. That is the honest and the stronger claim: not "trust my reasoning"
        but "here is the reasoning I committed to, check it yourself."
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

function Sdk() {
  return (
    <article className="doc-article">
      <h2>SDK</h2>
      <p>
        <code>avow-sdk</code> is the programmatic way in. Your agent does whatever it does, then
        calls <code>anchor()</code> once. An auditor service calls <code>verify()</code>. Both are
        plain TypeScript.
      </p>

      <CodeBlock caption="install" code={`npm i avow-sdk`} />

      <h3>Anchor an action</h3>
      <p>
        After the agent acts, the whole integration is one call. The clients are the connections
        to Sui, Seal, and Walrus; <code>signer</code> is the agent key; <code>bundle</code> is the
        evidence.
      </p>
      <CodeBlock
        caption="anchor.ts"
        code={`import {
  getSuiClient, getSealClient, getWalrusClient,
  anchor, EVIDENCE_VERSION,
} from "avow-sdk";

const sui = getSuiClient();

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

      <h3>Verify a record</h3>
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

      <h3>Set up a mandate</h3>
      <p>
        Before an agent can anchor, the owner mints a mandate (the rules) and an access object
        (the vault). <code>createMandate</code> does both and returns their ids.
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
    </article>
  );
}

function Cli() {
  return (
    <article className="doc-article">
      <h2>Command line</h2>
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
