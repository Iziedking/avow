// A custom connect modal so the copy is about Avow, not generic wallet text, and so the
// common Sui wallets (Slush, OKX, Bitget, Suiet) are always offered, with install links when
// they are not detected. Built on dapp-kit's wallet hooks.

import { useState } from "react";
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

  return (
    <div className="wc">
      <button className="wc-btn" onClick={() => setOpen(true)}>
        Connect Wallet
      </button>

      {open && (
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
              <h4>New to wallets?</h4>
              <p>
                A wallet is how you sign in here and prove who you are, with no passwords. On
                Avow you connect one to verify a record privately, or to set up and manage your
                own agent.
              </p>
              <p>
                Avow never holds your funds. A wallet only lets you decrypt the evidence you are
                allowed to read and sign the actions you choose.
              </p>
            </div>

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
        </div>
      )}
    </div>
  );
}
