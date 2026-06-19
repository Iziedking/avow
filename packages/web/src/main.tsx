import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { App } from "./App";
import { AgentConsole } from "./AgentConsole";
import { DevConsole } from "./DevConsole";
import { isDevMode } from "./devmode";
import { avowDark } from "./theme";

// Three surfaces: ?console instructs the agent, ?dev is the developer/admin terminal (only when
// developer mode is on — otherwise it stays hidden behind the home page), and everything else is
// the dashboard (the Avow home, where you verify).
function Root() {
  let route = "";
  try {
    const q = new URLSearchParams(window.location.search);
    route = q.has("dev") ? "dev" : q.has("console") ? "console" : "";
  } catch {
    route = "";
  }
  if (route === "dev") return isDevMode() ? <DevConsole /> : <App />;
  if (route === "console") return <AgentConsole />;
  return <App />;
}
// Latin only, to keep the Walrus Site lean. Fraunces uses the weight-axis file; Plex Mono the
// latin subset of the three weights we use.
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource-variable/saira/wght.css";
import "@fontsource-variable/orbitron/wght.css";
import "@fontsource/saira-stencil-one/latin.css";
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
          <Root />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
