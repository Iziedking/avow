// A connect modal with Avow's own copy instead of dapp-kit's generic "what is a wallet" text,
// and the common Sui wallets always offered. Rendered through a portal to document.body so the
// overlay always covers the viewport and never gets trapped inside a transformed ancestor.

import { useState } from "react";
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

  if (account) {
    return (
      <div className="wc">
        <button className="wc-btn" onClick={() => setMenu((m) => !m)}>
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
      <div className="wc-modal hud" onClick={(e) => e.stopPropagation()}>
        <div className="wc-head">
          <span>Connect a wallet</span>
          <button className="wc-x" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </div>

        {wallets.length > 0 && (
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
        )}

        <div className="wc-about">
          <h4>Sign in, no passwords</h4>
          <p>
            Connect a wallet instead of creating an account. It is how you identify yourself on
            Avow and approve what your agent does.
          </p>
          <h4>You keep control</h4>
          <p>
            Avow never holds your funds. Your wallet only decrypts the evidence you are
            authorized to read and signs the transactions you choose.
          </p>
        </div>

        {toGet.length > 0 && (
          <div className="wc-install">
            <h4>Don't have one? Get a Sui wallet</h4>
            <div className="wc-get-row">
              {toGet.map((r) => (
                <a key={r.name} href={r.url} target="_blank" rel="noreferrer" className="wc-get">
                  {r.name} ↗
                </a>
              ))}
            </div>
          </div>
        )}
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
