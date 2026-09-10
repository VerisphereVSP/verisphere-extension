/**
 * Runs in the page's MAIN world (where `window.ethereum` lives). Bridges
 * EIP-1193 requests from the Verisphere content script (ISOLATED world) to the
 * injected wallet via window.postMessage. Both worlds share `window`, so a
 * posted message is received on the other side.
 *
 * Protocol (all tagged `__verisphere: true`):
 *   req  { dir:"req", id, method, params }   content → page
 *   res  { dir:"res", id, result | error }   page → content
 *
 * patch_ext_wallet — multi-wallet (EIP-6963): with several wallet extensions
 * installed, `window.ethereum` is whichever one won the injection race (in
 * practice Coinbase Wallet), so users could never reach MetaMask. Every wallet
 * announces itself via `eip6963:announceProvider`; we collect those and let
 * the content side list/select them. Two local methods (never forwarded):
 *   vs_listProviders            → [{uuid,name,icon,rdns}]
 *   vs_selectProvider [rdns]    → true
 * Resolution order: selected → the only one → MetaMask if present → window.ethereum.
 */
type Provider = { request(a: { method: string; params?: unknown[] }): Promise<unknown> };
type Info = { uuid: string; name: string; icon: string; rdns: string };
type Announced = { info: Info; provider: Provider };

const ALLOWED_METHODS = new Set<string>([
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "eth_getBalance",
  "eth_getTransactionReceipt",
  "eth_sendTransaction",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]);
const discovered = new Map<string, Announced>();
let selectedRdns: string | undefined;

window.addEventListener("eip6963:announceProvider", (e: Event) => {
  const d = (e as CustomEvent<Announced>).detail;
  if (d?.info?.rdns && d.provider) discovered.set(d.info.rdns, d);
});
const requestProviders = () => window.dispatchEvent(new Event("eip6963:requestProvider"));
requestProviders();

const getProvider = (): Provider | undefined => {
  if (selectedRdns && discovered.has(selectedRdns)) return discovered.get(selectedRdns)!.provider;
  if (discovered.size === 1) return [...discovered.values()][0].provider;
  if (discovered.has("io.metamask")) return discovered.get("io.metamask")!.provider;
  return (window as unknown as { ethereum?: Provider }).ethereum;
};

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) return;
  const d = event.data as { __verisphere?: boolean; dir?: string; id?: number; method?: string; params?: unknown[] };
  if (!d || d.__verisphere !== true || d.dir !== "req") return;

  const reply = (payload: Record<string, unknown>) =>
    window.postMessage({ __verisphere: true, dir: "res", id: d.id, ...payload }, "*");

  if (d.method === "vs_listProviders") {
    requestProviders(); // wallets re-announce on request; catch late loaders
    await new Promise((r) => setTimeout(r, 50));
    reply({ result: [...discovered.values()].map((p) => p.info) });
    return;
  }
  if (d.method === "vs_selectProvider") {
    const rdns = String(d.params?.[0] ?? "");
    selectedRdns = discovered.has(rdns) ? rdns : undefined;
    reply({ result: selectedRdns !== undefined });
    return;
  }

  // Review 3 (2026-09-10): this bridge must not be a generic EIP-1193 proxy
  // for page JavaScript. Only the methods the wallet layer actually uses.
  if (!ALLOWED_METHODS.has(d.method ?? "")) {
    reply({ error: `Method not allowed by the Verisphere bridge: ${d.method}` });
    return;
  }
  const provider = getProvider();
  if (!provider) {
    reply({ error: "No injected wallet found. Install MetaMask (or similar) and reload." });
    return;
  }
  try {
    const result = await provider.request({ method: d.method!, params: d.params ?? [] });
    reply({ result });
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown; data?: { message?: unknown } } | undefined;
    const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
    // EIP-1193 errors are plain objects; pull the message out so it doesn't
    // reach the UI as "[object Object]".
    const message =
      err instanceof Error
        ? err.message
        : typeof e?.message === "string"
          ? e.message
          : typeof e?.data?.message === "string"
            ? e.data.message
            : typeof err === "string"
              ? err
              : "Request failed";
    reply({ error: message, code });
  }
});

export {};
