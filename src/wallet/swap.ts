import { env } from "../shared/env";
import { bgFetch } from "../api/bgFetch";
import { providerRequest } from "./bridge";
import { wallet } from "./wallet";
import { ensureCorrectChain } from "./network";
import { waitForReceipt } from "./direct";
import { SELECTORS, encodeCall, decodeUint } from "./abi";
import type { Currency, TradeSide } from "./swapMath";
import {
  approveCalldata,
  tokenIn as tokenInFor,
  verifyPoolBuild,
  verifyRoutes,
  type PoolBuild,
  type PoolQuote,
  type PoolRoutes,
} from "./swapVerify";

/**
 * Trade VSP from inside the panel — buy with AVAX or USDC, sell for AVAX or USDC —
 * from the user's wallet against the public pool, in one router transaction.
 *
 * The app plans and encodes the trade (GET /pool/routes, GET /pool/quote,
 * POST /pool/build — see app/pool_trade.py); this module fetches those, verifies
 * the built calldata field by field (swapVerify.ts) and has the wallet sign it.
 * Only ERC-20 balance/allowance reads go through the wallet's RPC (eth_call).
 *
 *   buy  with AVAX   swapExact{ETH|AVAX}ForTokens, path [WAVAX, USDC, VSP], AVAX as
 *                    msg.value — no approval, one wallet prompt.
 *   buy  with USDC   swapExactTokensForTokens, path [USDC, VSP].
 *   sell for  AVAX   swapExactTokensFor{ETH|AVAX}, path [VSP, USDC, WAVAX].
 *   sell for  USDC   swapExactTokensForTokens, path [VSP, USDC].
 *                    Token in (USDC or VSP) needs a one-time standing approval to the
 *                    router: the first such trade on a wallet is approve + swap, every
 *                    later one is a single transaction.
 *
 * The user pays gas on every trade (no relay for third-party pools).
 */

export type SwapConfig = PoolRoutes;

/** Raised when the in-panel flow can't run; the UI falls back to a link. */
export class SwapUnavailable extends Error {}

const appBase = env.appApiBase;

let _cfg: Promise<SwapConfig> | null = null;

/** Fetch (and cache for the page) the route table. */
export function loadSwapConfig(): Promise<SwapConfig> {
  if (!_cfg) {
    _cfg = fetchRoutes().catch((e) => {
      _cfg = null; // don't cache failures
      throw e;
    });
  }
  return _cfg;
}

export function resetSwapConfig(): void {
  _cfg = null;
}

async function fetchRoutes(): Promise<SwapConfig> {
  const res = await bgFetch<PoolRoutes>(`${appBase}/pool/routes`);
  if (!res.ok || !res.json) throw new SwapUnavailable(res.json ? detail(res.json) : res.error || "Pool routes unavailable");
  try {
    verifyRoutes(res.json);
  } catch (e) {
    throw new SwapUnavailable(e instanceof Error ? e.message : String(e));
  }
  return res.json;
}

function detail(j: unknown): string {
  const d = (j as { detail?: unknown })?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0] && typeof (d[0] as { msg?: unknown }).msg === "string") return (d[0] as { msg: string }).msg;
  return "Request failed";
}

async function ethCall(to: string, data: string): Promise<string> {
  return providerRequest<string>("eth_call", [{ to, data }, "latest"]);
}

export async function tokenBalance(token: string, owner: string): Promise<bigint> {
  return decodeUint(await ethCall(token, encodeCall(SELECTORS.balanceOf, [{ t: "address", v: owner }])));
}

async function allowance(token: string, owner: string, spender: string): Promise<bigint> {
  return decodeUint(
    await ethCall(token, encodeCall(SELECTORS.allowance, [{ t: "address", v: owner }, { t: "address", v: spender }])),
  );
}

export interface TradeQuote extends PoolQuote {
  /** The human amount the user typed (what we'll send to /pool/build). */
  amountHuman: number;
  /** Wallet confirmations this trade will take (an approval first, when needed). */
  steps: number;
}

export async function quoteTrade(
  cfg: SwapConfig,
  side: TradeSide,
  currency: Currency,
  amountHuman: number,
  owner?: string | null,
): Promise<TradeQuote> {
  if (!(amountHuman > 0)) throw new Error("Enter an amount");
  if (currency === "AVAX" && !cfg.routes.AVAX) throw new Error("The AVAX route isn't available on this venue — use USDC.");
  const q = new URLSearchParams({ side, pay_with: currency, amount: String(amountHuman), slippage_bps: String(cfg.defaultSlippageBps) });
  const res = await bgFetch<PoolQuote>(`${appBase}/pool/quote?${q}`);
  if (!res.ok || !res.json) throw new Error(res.json ? detail(res.json) : res.error || "Quote failed");
  const quote = res.json;
  let steps = 1;
  const pulls = tokenInFor(cfg, side, currency);
  if (pulls && owner && (await allowance(pulls, owner, cfg.router)) < BigInt(quote.amountIn)) steps += 1;
  return { ...quote, amountHuman, steps };
}

export interface TradeProgress {
  step: "approve" | "swap";
  index: number; // 1-based
  total: number;
  phase: "sign" | "confirm";
}

function from(): string {
  const a = wallet.getState().address;
  if (!a) throw new Error("Wallet not connected");
  return a;
}

async function sendTx(to: string, data: string, valueWei = 0n): Promise<string> {
  const tx: Record<string, string> = { from: from(), to, data };
  if (valueWei > 0n) tx.value = "0x" + valueWei.toString(16);
  return providerRequest<string>("eth_sendTransaction", [tx]);
}

const RECEIPT_TIMEOUT_MS = 120_000;

/**
 * Run the trade the user was quoted. Reports each wallet confirmation through
 * `onProgress`; refreshes the wallet's balances when done so writeMode flips from
 * "needs-vsp" on its own after a buy. Resolves to the minimum output guaranteed on chain.
 */
export async function executeTrade(cfg: SwapConfig, q: TradeQuote, onProgress: (p: TradeProgress) => void): Promise<bigint> {
  await ensureCorrectChain();
  const user = from();

  const res = await bgFetch<PoolBuild>(`${appBase}/pool/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ side: q.side, pay_with: q.payWith, amount: q.amountHuman, recipient: user, slippage_bps: q.slippageBps }),
  });
  if (!res.ok || !res.json) throw new Error(res.json ? detail(res.json) : res.error || "Failed to build the swap");
  const v = verifyPoolBuild({
    routes: cfg,
    side: q.side,
    currency: q.payWith,
    user,
    amountHuman: q.amountHuman,
    quote: q,
    build: res.json,
    nowS: Math.floor(Date.now() / 1000),
  });

  const needsApproval = v.approve != null && (await allowance(v.approve.token, user, cfg.router)) < v.amountIn;
  const total = needsApproval ? 2 : 1;
  let index = 0;
  const run = async (step: TradeProgress["step"], send: () => Promise<string>) => {
    index += 1;
    onProgress({ step, index, total, phase: "sign" });
    const hash = await send();
    onProgress({ step, index, total, phase: "confirm" });
    await waitForReceipt(hash, RECEIPT_TIMEOUT_MS);
  };

  try {
    if (needsApproval && v.approve) {
      const { token, amount } = v.approve;
      await run("approve", () => sendTx(token, approveCalldata(cfg.router, amount)));
    }
    await run("swap", () => sendTx(v.to, v.data, v.valueWei));
    return v.minOut;
  } finally {
    // Whatever happened, show the wallet's real balances.
    await wallet.refresh().catch(() => {});
  }
}
