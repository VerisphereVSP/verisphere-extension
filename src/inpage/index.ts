/**
 * Runs in the page's MAIN world (where `window.ethereum` lives). Bridges
 * EIP-1193 requests from the VeriSphere content script (ISOLATED world) to the
 * injected wallet via window.postMessage. Both worlds share `window`, so a
 * posted message is received on the other side.
 *
 * Protocol (all tagged `__verisphere: true`):
 *   req  { dir:"req", id, method, params }   content → page
 *   res  { dir:"res", id, result | error }   page → content
 */
type Provider = { request(a: { method: string; params?: unknown[] }): Promise<unknown> };
// Look up the provider at REQUEST time, not module load — at document_start the
// wallet may not have injected window.ethereum yet.
const getProvider = (): Provider | undefined =>
  (window as unknown as { ethereum?: Provider }).ethereum;

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) return;
  const d = event.data as { __verisphere?: boolean; dir?: string; id?: number; method?: string; params?: unknown[] };
  if (!d || d.__verisphere !== true || d.dir !== "req") return;

  const reply = (payload: Record<string, unknown>) =>
    window.postMessage({ __verisphere: true, dir: "res", id: d.id, ...payload }, "*");

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
