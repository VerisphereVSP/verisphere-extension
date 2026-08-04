/**
 * Build-time environment config for the Verity extension.
 *
 * The extension now talks ONLY to the verity-api gateway (which proxies to the
 * app and reads chain state server-side), so the client needs just the gateway
 * URL. Values are inlined from Vite env files (`.env.<mode>`) selected via
 * `--env <name>` (mapped to Vite's `--mode` by scripts/run.mjs).
 */
export const env = {
  /** verity-api gateway — value-add only (atomicity, resolve, relay build/config). */
  verityApiUrl: import.meta.env.VITE_VERITY_API_URL ?? "http://localhost:8790",
  /**
   * Verisphere app API — called directly (via the background worker, which
   * bypasses CORS and preserves the user's IP for the app's rate limiting).
   * Used for plain passthrough reads/writes (claims, token, relay submit).
   */
  appApiBase: import.meta.env.VITE_APP_API_BASE ?? "https://test.verisphere.co/api",
  /** Data adapter: "mock" (self-contained demo) or "http" (live gateway). */
  apiMode: (import.meta.env.VITE_API_MODE ?? "mock") as "mock" | "http",
  /** Where "Buy VSP" sends users when their wallet has none. */
  buyVspUrl: import.meta.env.VITE_BUY_VSP_URL ?? "https://test.verisphere.co",
  /** The app's portfolio page — the user's stakes and earnings (opens in a new tab). */
  portfolioUrl: import.meta.env.VITE_PORTFOLIO_URL ?? "https://test.verisphere.co/portfolio",
  /** Minimum AVAX (human units) to consider a wallet able to self-pay gas. */
  minAvaxForGas: Number(import.meta.env.VITE_MIN_AVAX_FOR_GAS ?? 0.01),
} as const;
