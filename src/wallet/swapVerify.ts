/**
 * Pure checks for the app's pool-trade responses (GET /pool/routes, GET /pool/quote,
 * POST /pool/build). No fetch, no wallet — unit-tested with node:test.
 *
 * The app plans the trade and encodes the router call; we never sign its bytes
 * blind (same stance as verifyBuild.ts for stakes). verifyPoolBuild re-encodes the
 * call from the fields the response states and requires the bytes to match, and
 * checks every field against what the user asked for: the router, the token path,
 * the recipient, the amount in, the minimum out, the deadline and the AVAX value.
 */
// .ts extensions so node:test can import this module directly (Vite resolves them too).
import { SELECTORS, encodeCall } from "./abi.ts";
import { MAX_UINT256, type Currency, type TradeSide } from "./swapMath.ts";

export type NativeFlavour = "ETH" | "AVAX"; // Uniswap v2 Router02 vs. JoeRouter02 naming

export interface PoolRoutes {
  configured: boolean;
  chainId: number;
  router: string;
  native: NativeFlavour;
  selectors: { swapExactNativeForTokens: string; swapExactTokensForNative: string; swapExactTokensForTokens: string };
  tokens: { wavax: string; usdc: string; vsp: string };
  routes: { AVAX: boolean; USDC: boolean };
  feeBpsPerHop: number;
  defaultSlippageBps: number;
  maxSlippageBps: number;
  defaultDeadlineS: number;
}

export interface PoolQuote {
  side: TradeSide;
  payWith: Currency;
  path: string[];
  amountIn: string; // smallest units
  amountInHuman: number;
  symbolIn: "AVAX" | "USDC" | "VSP";
  symbolOut: "AVAX" | "USDC" | "VSP";
  amountOut: string;
  amountOutHuman: number;
  minOut: string;
  minOutHuman: number;
  priceImpactBps: number;
  feeBps: number;
  hops: number;
  slippageBps: number;
  native: NativeFlavour;
  router: string;
}

export interface PoolBuild {
  to: string;
  data: string;
  value: string; // wei, decimal string
  fn?: string;
  path: string[];
  amountIn: string;
  minOut: string;
  deadline: number; // unix seconds
  quote: PoolQuote;
  approve?: { token: string; spender: string; amount: string };
}

/** The selectors each router flavour must use — pinned here so a backend can't swap one in. */
export const KNOWN_SELECTORS: Record<NativeFlavour, PoolRoutes["selectors"]> = {
  ETH: { swapExactNativeForTokens: "7ff36ab5", swapExactTokensForNative: "18cbafe5", swapExactTokensForTokens: "38ed1739" },
  AVAX: { swapExactNativeForTokens: "a2a1623d", swapExactTokensForNative: "676528d1", swapExactTokensForTokens: "38ed1739" },
};

const DECIMALS = { AVAX: 18, USDC: 6, VSP: 18 } as const;
export const SYMBOL_DECIMALS = DECIMALS;

/** Smallest units for a human amount of a symbol, the way the app computes amountIn. */
export function toUnits(amount: number, symbol: keyof typeof DECIMALS): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS[symbol]));
}

const lower = (a: string) => a.toLowerCase();

/** Sanity-check the route table itself (addresses present, selectors are the known ones). */
export function verifyRoutes(r: PoolRoutes): void {
  if (!r.configured) throw new Error("Pool trading isn't configured on this network yet.");
  for (const [k, v] of Object.entries({ router: r.router, ...r.tokens })) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(v ?? "")) throw new Error(`Pool routes: ${k} is not an address`);
  }
  const known = KNOWN_SELECTORS[r.native];
  if (!known) throw new Error(`Pool routes: unknown router flavour ${String(r.native)}`);
  for (const k of Object.keys(known) as Array<keyof typeof known>) {
    if (lower(r.selectors?.[k] ?? "").replace(/^0x/, "") !== known[k]) {
      throw new Error(`Pool routes: selector ${k} is not the ${r.native} router's`);
    }
  }
}

/** Token path for a trade, built from the route table (never from the response). */
export function expectedPath(r: PoolRoutes, side: TradeSide, currency: Currency): string[] {
  const { wavax, usdc, vsp } = r.tokens;
  const legs = currency === "AVAX" ? [wavax, usdc, vsp] : [usdc, vsp];
  return (side === "buy" ? legs : [...legs].reverse()).map(lower);
}

export function expectedSelector(r: PoolRoutes, side: TradeSide, currency: Currency): string {
  const s = KNOWN_SELECTORS[r.native];
  if (currency === "AVAX") return "0x" + (side === "buy" ? s.swapExactNativeForTokens : s.swapExactTokensForNative);
  return "0x" + s.swapExactTokensForTokens;
}

/** The token the router pulls from the user (null when native AVAX is paid in). */
export function tokenIn(r: PoolRoutes, side: TradeSide, currency: Currency): string | null {
  if (side === "buy") return currency === "AVAX" ? null : lower(r.tokens.usdc);
  return lower(r.tokens.vsp);
}

export interface VerifiedTrade {
  to: string;
  data: string;
  valueWei: bigint;
  amountIn: bigint;
  minOut: bigint;
  /** Approval the router needs first: token, and how much to approve. */
  approve: { token: string; amount: bigint } | null;
}

/** Tolerated worsening of minOut between the quote the user saw and the build (bps). */
export const PRICE_DRIFT_BPS = 200; // 2%

/**
 * Throws unless `build` encodes exactly the trade the user asked for. `quote` is the
 * quote the user was shown; `nowS` is the current unix time (injected for tests).
 */
export function verifyPoolBuild(args: {
  routes: PoolRoutes;
  side: TradeSide;
  currency: Currency;
  user: string;
  amountHuman: number;
  quote: PoolQuote;
  build: PoolBuild;
  nowS: number;
}): VerifiedTrade {
  const { routes, side, currency, user, amountHuman, quote, build, nowS } = args;
  const fail = (why: string): never => {
    throw new Error(`Refusing to sign: the server-built swap failed verification (${why}).`);
  };

  if (!build || typeof build !== "object") fail("no transaction returned");
  if (lower(build.to ?? "") !== lower(routes.router)) fail("destination is not the pool router");
  const path = (build.path ?? []).map(lower);
  const want = expectedPath(routes, side, currency);
  if (path.length !== want.length || path.some((a, i) => a !== want[i])) fail("token path was changed");

  const symbolIn = side === "buy" ? currency : "VSP";
  const amountIn = BigInt(build.amountIn ?? "0");
  const asked = toUnits(amountHuman, symbolIn);
  // The app rounds the human amount to units the same way; allow 1 unit of rounding slack.
  if (amountIn <= 0n || (amountIn > asked ? amountIn - asked : asked - amountIn) > 1n) fail("amount in was changed");

  const minOut = BigInt(build.minOut ?? "0");
  if (minOut <= 0n) fail("minimum out is zero");
  const shown = BigInt(quote.minOut ?? "0");
  if (minOut < (shown * BigInt(10_000 - PRICE_DRIFT_BPS)) / 10_000n) {
    throw new Error("The price moved more than 2% since the quote — please try again.");
  }

  const deadline = Number(build.deadline);
  if (!Number.isFinite(deadline) || deadline < nowS + 30 || deadline > nowS + Math.max(routes.defaultDeadlineS, 60) * 3 + 60) {
    fail("deadline is out of range");
  }

  const nativeIn = side === "buy" && currency === "AVAX";
  const valueWei = BigInt(build.value ?? "0");
  if (nativeIn ? valueWei !== amountIn : valueWei !== 0n) fail("AVAX value does not match the trade");

  // The decisive check: the bytes must be exactly the call these fields describe.
  const selector = expectedSelector(routes, side, currency);
  const callArgs = nativeIn
    ? [
        { t: "uint256" as const, v: minOut },
        { t: "address[]" as const, v: path },
        { t: "address" as const, v: user },
        { t: "uint256" as const, v: BigInt(deadline) },
      ]
    : [
        { t: "uint256" as const, v: amountIn },
        { t: "uint256" as const, v: minOut },
        { t: "address[]" as const, v: path },
        { t: "address" as const, v: user },
        { t: "uint256" as const, v: BigInt(deadline) },
      ];
  if (lower(build.data ?? "") !== encodeCall(selector, callArgs)) fail("calldata does not match the stated trade");

  // Approval, when the router pulls a token from the user.
  const needs = tokenIn(routes, side, currency);
  let approve: VerifiedTrade["approve"] = null;
  if (needs) {
    const a = build.approve;
    if (!a || lower(a.token) !== needs || lower(a.spender) !== lower(routes.router) || BigInt(a.amount) !== amountIn) {
      fail("approval does not match the trade");
    }
    // One-time standing approval for both tokens (the protocol asked for it on VSP
    // sells; USDC buys get the same so a repeat purchase is one prompt, as in any
    // wallet's swap). The router is the venue's immutable, audited contract. The
    // first trade of a token on a wallet is approve + swap; every later one is one tx.
    approve = { token: needs, amount: MAX_UINT256 };
  } else if (build.approve) {
    fail("an approval was attached to a native-AVAX trade");
  }

  return { to: lower(build.to), data: lower(build.data), valueWei, amountIn, minOut, approve };
}

/** Calldata for the approval step (encoded locally, never taken from the server). */
export function approveCalldata(spender: string, amount: bigint): string {
  return encodeCall(SELECTORS.approve, [{ t: "address", v: spender }, { t: "uint256", v: amount }]);
}
