import { providerRequest } from "./bridge";
import { getRelayConfig } from "./relayConfig";

/**
 * Ensure the injected wallet is on the chain this deployment targets (from
 * /relay/config). Prompts wallet_switchEthereumChain, falling back to
 * wallet_addEthereumChain if the wallet doesn't know the chain (code 4902).
 * Best-effort: if the current chain can't be read, we don't block.
 */
export async function ensureCorrectChain(): Promise<void> {
  const { chain } = await getRelayConfig();
  let current: string | null = null;
  try {
    current = await providerRequest<string>("eth_chainId");
  } catch {
    return; // can't read — don't block the flow
  }
  if (!current || current.toLowerCase() === chain.chainId.toLowerCase()) return;

  try {
    await providerRequest("wallet_switchEthereumChain", [{ chainId: chain.chainId }]);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    if (code === 4902 || code === "4902") {
      // Chain not in the wallet — add it (which also switches).
      await providerRequest("wallet_addEthereumChain", [chain]);
    } else {
      throw new Error(`Switch your wallet to ${chain.chainName} to continue.`);
    }
  }
}
