// Factory helpers for the three clients the Avow SDK drives: the Sui RPC client, the Seal
// encryption client, and the Walrus storage client.
//
// In @mysten/sui 2.x the classic client is SuiJsonRpcClient from @mysten/sui/jsonRpc, and it
// carries a `core` member. Because both the Seal and Walrus clients only require that core
// surface, one SuiJsonRpcClient instance serves all three. Reuse a single instance so Seal
// can cache fetched keys across decryptions.

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { SealClient } from "@mysten/seal";
import { WalrusClient } from "@mysten/walrus";
import { NETWORK, SEAL_KEY_SERVERS } from "./config";

export function getSuiClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(NETWORK),
    network: NETWORK,
  });
}

export function getSealClient(suiClient: SuiJsonRpcClient): SealClient {
  return new SealClient({
    suiClient,
    serverConfigs: SEAL_KEY_SERVERS,
    // We verify the seal_approve policy on chain, not the key servers' identities, so URL
    // verification only adds latency during development.
    verifyKeyServers: false,
  });
}

export function getWalrusClient(suiClient: SuiJsonRpcClient): WalrusClient {
  return new WalrusClient({
    network: NETWORK,
    suiClient,
  });
}
