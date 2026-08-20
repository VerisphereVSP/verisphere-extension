import { env } from "../shared/env";
import { bgFetch } from "../api/bgFetch";

/** EIP-3085 chain params for wallet_switchEthereumChain / wallet_addEthereumChain. */
export interface ChainParams {
  chainId: string; // hex
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

export interface RelayConfig {
  chainId: number;
  forwarder: { address: string; name: string; version: string };
  token: { address: string; name: string; version: string };
  postingFeeWei: string;
  addresses: { stakeEngine: string; postRegistry: string; vspToken: string };
  chain: ChainParams;
}

let _cfg: RelayConfig | null = null;

/** Fetch (and cache) the signing + chain config from the app. Holds the EIP-712
 *  domains the wallet must sign against, so we ship no ABIs or addresses. */
export async function getRelayConfig(): Promise<RelayConfig> {
  if (_cfg) return _cfg;
  const res = await bgFetch<RelayConfig>(`${env.appApiBase}/relay/config`);
  if (!res.ok || !res.json) throw new Error(res.error ?? "Relay config unavailable");
  _cfg = res.json;
  return _cfg;
}
