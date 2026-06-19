// The wallet popup, in the shape of dapp-kit's default two-pane modal: the wallet list on the
// left, and where the generic "what is a wallet" write-up sat, a sci-fi secure-link loader that
// echoes the landing page boot. Rendered through a portal so the overlay always covers the
// viewport and never gets trapped inside a transformed ancestor.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  useWallets,
  useConnectWallet,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";

const RECOMMENDED = [
  { name: "Slush", url: "https://slush.app" },
  { name: "OKX Wallet", url: "https://www.okx.com/web3" },
  { name: "Bitget Wallet", url: "https://web3.bitget.com/en/wallet" },
  { name: "Suiet", url: "https://suiet.app" },
];

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// The sci-fi panel that stands in for the old write-up: a console establishing the link.
function SecureLink() {
  return (
    <div className="wc-link">
      <span className="wc-link-tag">
        <span className="wc-link-dot" /> secure link
      </span>

      <div className="wc-link-core">
        <svg viewBox="0 0 512 512" fill="none" aria-hidden="true" className="wc-link-mark">
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
      </div>

      <div className="wc-link-bar">
        <span />
      </div>

      <ul className="wc-link-log">
        <li>establishing secure channel</li>
        <li className="wc-link-cur">awaiting wallet handshake</li>
      </ul>
    </div>
  );
}

export function WalletConnect() {
  const wallets = useWallets();
  const account = useCurrentAccount();
  const { mutate: connect } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();
  const [open, setOpen] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).has("wc");
    } catch {
      return false;
    }
  });
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (account) {
    return (
      <div className="wc">
        <button className="wc-btn is-connected" onClick={() => setMenu((m) => !m)}>
          <span className="wc-dot" aria-hidden="true" />
          {short(account.address)}
        </button>
        {menu && (
          <div className="wc-menu">
            <button
              onClick={() => {
                disconnect();
                setMenu(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  const installed = new Set(wallets.map((w) => w.name));
  const toGet = RECOMMENDED.filter((r) => !installed.has(r.name));

  const modal = (
    <div className="wc-overlay" onClick={() => setOpen(false)}>
      <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
        <button className="wc-x" onClick={() => setOpen(false)} aria-label="Close">
          ×
        </button>

        <div className="wc-grid">
          <div className="wc-pane wc-pane-connect">
            <h3 className="wc-pane-title">Connect a Wallet</h3>

            {wallets.length > 0 ? (
              <div className="wc-list">
                {wallets.map((w) => (
                  <button
                    key={w.name}
                    className="wc-wallet"
                    onClick={() => connect({ wallet: w }, { onSuccess: () => setOpen(false) })}
                  >
                    {w.icon && <img src={w.icon} alt="" width={22} height={22} />}
                    <span>{w.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="wc-empty">No Sui wallet detected. Install one below to continue.</p>
            )}

            {toGet.length > 0 && (
              <div className="wc-install">
                <h4>Don't have one? Get a Sui wallet</h4>
                <div className="wc-get-row">
                  {toGet.map((r) => (
                    <a
                      key={r.name}
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="wc-get"
                    >
                      {r.name} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="wc-pane wc-pane-link">
            <SecureLink />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="wc">
      <button className="wc-btn" onClick={() => setOpen(true)}>
        Connect Wallet
      </button>
      {open && typeof document !== "undefined" && createPortal(modal, document.body)}
    </div>
  );
}
