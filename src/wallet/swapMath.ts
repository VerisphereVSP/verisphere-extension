/**
 * Pure helpers for the in-panel VSP trade flow (no fetch, no wallet — unit-tested
 * with node:test). Quotes, minimum-out and price impact come from the app
 * (pool_trade.py); this module only decides what the wallet can do and formats.
 */

export type TradeSide = "buy" | "sell";
/** The other side of a VSP trade: native AVAX or USDC. */
export type Currency = "AVAX" | "USDC";

/** AVAX kept back for gas when the user pays with AVAX. */
export const GAS_RESERVE_AVAX = 0.02;
/** Price impact (from the app's quote) above which the UI warns. */
export const IMPACT_WARN_PCT = 3;
/** Price impact above which the UI refuses to trade (a drained or far-too-shallow pool). */
export const IMPACT_BLOCK_PCT = 25;
export const MAX_UINT256 = (1n << 256n) - 1n;

/** Decimal text → a positive number, or null when it isn't one. */
export function parseAmount(text: string): number | null {
  if (!/^\s*(\d+\.?\d*|\.\d+)\s*$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Integer units → JS number (display only; fine for the magnitudes here). */
export function toNumber(v: bigint, decimals: number): number {
  return Number(v) / 10 ** decimals;
}

export interface Balances {
  avax: number; // native AVAX, human units
  usdc: number; // USDC, human units
  vsp: number; // VSP, human units
}

export interface TradeOption {
  currency: Currency;
  enabled: boolean;
  /** Why it is disabled (shown to the user). */
  reason?: string;
}

/** Which routes the venue offers (from /pool/routes). */
export interface RouteAvailability {
  AVAX: boolean;
  USDC: boolean;
}

/**
 * Which currencies this wallet can pay with when buying. Every trade is a
 * transaction the user pays gas for — there is no relay for third-party pools —
 * so AVAX is needed even when paying with USDC.
 */
export function buyOptions(b: Balances, minAvaxForGas: number, routes: RouteAvailability = { AVAX: true, USDC: true }): TradeOption[] {
  const hasGas = b.avax >= minAvaxForGas;
  const avax: TradeOption = !routes.AVAX
    ? { currency: "AVAX", enabled: false, reason: "The AVAX route isn't available on this venue" }
    : b.avax <= 0
      ? { currency: "AVAX", enabled: false, reason: "No AVAX in this wallet" }
      : b.avax <= GAS_RESERVE_AVAX
        ? { currency: "AVAX", enabled: false, reason: `Only enough AVAX for gas (${GAS_RESERVE_AVAX} AVAX is kept back)` }
        : { currency: "AVAX", enabled: true };
  const usdc: TradeOption = !routes.USDC
    ? { currency: "USDC", enabled: false, reason: "The USDC route isn't available on this venue" }
    : b.usdc <= 0
      ? { currency: "USDC", enabled: false, reason: "No USDC in this wallet" }
      : !hasGas
        ? { currency: "USDC", enabled: false, reason: `Needs at least ${minAvaxForGas} AVAX for gas` }
        : { currency: "USDC", enabled: true };
  return [avax, usdc];
}

/** Which currencies the wallet can receive when selling VSP (needs VSP, and AVAX for gas). */
export function sellOptions(b: Balances, minAvaxForGas: number, routes: RouteAvailability = { AVAX: true, USDC: true }): TradeOption[] {
  const reason = b.vsp <= 0 ? "No VSP to sell" : b.avax < minAvaxForGas ? `Needs at least ${minAvaxForGas} AVAX for gas` : undefined;
  return (["AVAX", "USDC"] as Currency[]).map((currency) =>
    !routes[currency]
      ? { currency, enabled: false, reason: `The ${currency} route isn't available on this venue` }
      : reason
        ? { currency, enabled: false, reason }
        : { currency, enabled: true },
  );
}

/** One sentence for a wallet that can't trade at all (every option disabled). */
export function blockedMessage(side: TradeSide, b: Balances, minAvaxForGas: number): string {
  if (side === "sell") {
    if (b.vsp <= 0) return "This wallet holds no VSP to sell.";
    return `Selling is a transaction you pay gas for. Send at least ${minAvaxForGas} AVAX to this wallet, then come back.`;
  }
  if (b.avax < minAvaxForGas && b.usdc > 0) {
    return `You have USDC but no AVAX for gas. Send a little AVAX (≥ ${minAvaxForGas}) to this wallet, then come back.`;
  }
  if (b.avax > 0 && b.avax <= GAS_RESERVE_AVAX) {
    return "This wallet only holds enough AVAX for gas. Add more AVAX, or some USDC, to buy VSP.";
  }
  return "This wallet holds no AVAX or USDC on Avalanche. Send some of either (plus a little AVAX for gas) to this wallet, then come back.";
}

/** The most the user can put in: the pay currency when buying, VSP when selling. */
export function maxSpend(side: TradeSide, currency: Currency, b: Balances): number {
  if (side === "sell") return Math.max(0, b.vsp);
  if (currency === "USDC") return Math.max(0, b.usdc);
  return Math.max(0, b.avax - GAS_RESERVE_AVAX);
}

/** Compact number for the panel (no scientific notation, sane decimals). */
export function fmtAmount(n: number, dp = 4): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? Math.min(dp, 2) : dp;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}
