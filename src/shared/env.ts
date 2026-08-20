/**
 * Build-time environment config for the VeriSphere extension.
 *
 * The extension talks to ONE backend: the VeriSphere app API. Chain state,
 * signing config and the LLM key all live there, so the client needs no RPC
 * endpoint, no ABIs and no API keys of its own. Values are inlined from Vite env
 * files (`.env.<mode>`) selected via `--env <name>` (mapped to Vite's `--mode`
 * by scripts/run.mjs).
 */
export const env = {
  /**
   * VeriSphere app API — called via the background worker, which bypasses CORS
   * and preserves the user's IP for the app's per-IP rate limiting. Serves
   * everything: claim reads, article matching, claim checks, relay signing
   * config + calldata, and transaction submission.
   */
  appApiBase: import.meta.env.VITE_APP_API_BASE ?? "https://test.verisphere.co/api",
  /** Data adapter: "mock" (self-contained demo) or "http" (live app API). */
  apiMode: (import.meta.env.VITE_API_MODE ?? "mock") as "mock" | "http",
  /** Where "Buy VSP" sends users when their wallet has none. */
  buyVspUrl: import.meta.env.VITE_BUY_VSP_URL ?? "https://test.verisphere.co",
  /** The app's portfolio page — the user's stakes and earnings (opens in a new tab). */
  portfolioUrl: import.meta.env.VITE_PORTFOLIO_URL ?? "https://test.verisphere.co/portfolio",
  /** Minimum AVAX (human units) to consider a wallet able to self-pay gas. */
  minAvaxForGas: Number(import.meta.env.VITE_MIN_AVAX_FOR_GAS ?? 0.01),
} as const;
