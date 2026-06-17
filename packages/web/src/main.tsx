import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { App } from "./App";
import { avowDark } from "./theme";
// Latin only, to keep the Walrus Site lean. Fraunces uses the weight-axis file; Plex Mono the
// latin subset of the three weights we use.
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@mysten/dapp-kit/dist/index.css";
import "./styles.css";

const queryClient = new QueryClient();
const networks = {
  testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" as const },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <WalletProvider
          autoConnect
          theme={avowDark}
          slushWallet={{ name: "Avow" }}
          preferredWallets={["Slush", "OKX Wallet", "Bitget Wallet", "Suiet"]}
        >
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
