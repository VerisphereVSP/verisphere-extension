/**
 * Content-script side of the injected-wallet bridge. Sends EIP-1193 requests to
 * the MAIN-world inpage script (src/inpage) and resolves the matching reply.
 */
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const pending = new Map<number, Pending>();
let seq = 0;
let listening = false;

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const d = event.data as { __verisphere?: boolean; dir?: string; id?: number; result?: unknown; error?: string; code?: unknown };
    if (!d || d.__verisphere !== true || d.dir !== "res" || d.id == null) return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.error) {
      const e = new Error(d.error) as Error & { code?: unknown };
      e.code = d.code; // preserve EIP-1193 error code (e.g. 4902 unknown chain)
      p.reject(e);
    } else {
      p.resolve(d.result);
    }
  });
}

/** Send an EIP-1193 request to the page's injected wallet. */
export function providerRequest<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  ensureListener();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    window.postMessage({ __verisphere: true, dir: "req", id, method, params }, "*");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Wallet request timed out (is the page focused and the wallet unlocked?)"));
      }
    }, 60_000);
  });
}
