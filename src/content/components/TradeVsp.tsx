import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../shared/tokens";
import { env } from "../../shared/env";
import { useWallet } from "../../wallet/useWallet";
import { formatTxError } from "../../wallet/errors";
import {
  SwapUnavailable,
  executeTrade,
  loadSwapConfig,
  quoteTrade,
  resetSwapConfig,
  tokenBalance,
  type SwapConfig,
  type TradeProgress,
  type TradeQuote,
} from "../../wallet/swap";
import { SYMBOL_DECIMALS } from "../../wallet/swapVerify";
import {
  IMPACT_BLOCK_PCT,
  IMPACT_WARN_PCT,
  blockedMessage,
  buyOptions,
  fmtAmount,
  maxSpend,
  parseAmount,
  sellOptions,
  toNumber,
  type Currency,
  type TradeSide,
} from "../../wallet/swapMath";
import { Dots } from "./Dots";

/**
 * Buy or sell VSP right here — with AVAX or USDC, from the user's wallet against
 * the public pool, in one router transaction (wallet/swap.ts). Links out to the
 * app only as a fallback when the in-panel flow can't run.
 */
export function TradeVsp({ side, onTraded }: { side: TradeSide; onTraded?: (out: number, currency: Currency) => void }) {
  const { address, avax, balance } = useWallet();
  const [cfg, setCfg] = useState<SwapConfig | null>(null);
  const [cfgSeq, setCfgSeq] = useState(0); // bump to re-read routes + balances (after a trade)
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [currency, setCurrency] = useState<Currency | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [progress, setProgress] = useState<TradeProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ out: number; currency: Currency } | null>(null);
  const quoteSeq = useRef(0);

  // Route table (cached per page).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await loadSwapConfig();
        if (alive) setCfg(c);
      } catch (e) {
        if (alive) setUnavailable(e instanceof SwapUnavailable ? e.message : formatTxError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [cfgSeq]);

  // This wallet's USDC balance: read now, again whenever the wallet's own balances
  // refresh (avax/balance change), and on a timer — so USDC sent to the wallet
  // shows up without a page reload, like AVAX and VSP do.
  useEffect(() => {
    if (!cfg) return;
    if (!address) {
      setUsdc(0);
      return;
    }
    let alive = true;
    const read = () =>
      tokenBalance(cfg.tokens.usdc, address)
        .then((b) => {
          if (alive) setUsdc(toNumber(b, SYMBOL_DECIMALS.USDC));
        })
        .catch(() => {});
    void read();
    const t = setInterval(() => {
      if (document.visibilityState !== "hidden") void read();
    }, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [cfg, address, avax, balance]);

  // Switching between buy and sell starts a fresh form.
  useEffect(() => {
    setAmount("");
    setQuote(null);
    setErr(null);
    setDone(null);
  }, [side]);

  const balances = useMemo(() => ({ avax: avax ?? 0, usdc: usdc ?? 0, vsp: balance ?? 0 }), [avax, usdc, balance]);
  const options = useMemo(() => {
    const routes = cfg?.routes ?? { AVAX: true, USDC: true };
    return side === "buy" ? buyOptions(balances, env.minAvaxForGas, routes) : sellOptions(balances, env.minAvaxForGas, routes);
  }, [side, balances, cfg]);
  const canTrade = options.some((o) => o.enabled);

  // Default to the first currency the wallet can actually use.
  useEffect(() => {
    if (currency && options.find((o) => o.currency === currency)?.enabled) return;
    const first = options.find((o) => o.enabled);
    setCurrency(first ? first.currency : null);
  }, [options, currency]);

  const inLabel = side === "sell" ? "VSP" : (currency ?? "");
  const outLabel = side === "buy" ? "VSP" : (currency ?? "");
  const outDecimals = SYMBOL_DECIMALS[outLabel === "" ? "VSP" : (outLabel as keyof typeof SYMBOL_DECIMALS)];
  const amountNum = useMemo(() => (currency ? parseAmount(amount) : null), [amount, currency]);
  const max = currency ? maxSpend(side, currency, balances) : 0;
  const overMax = amountNum != null && amountNum > max + 1e-12;

  // Debounced live quote from the app.
  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    if (!cfg || !currency || amountNum == null || overMax) return;
    const seq = ++quoteSeq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await quoteTrade(cfg, side, currency, amountNum, address);
        if (seq === quoteSeq.current) setQuote(q);
      } catch (e) {
        if (seq === quoteSeq.current) setQuoteErr(formatTxError(e));
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [cfg, side, currency, amountNum, overMax, address]);

  async function trade() {
    if (!cfg || !quote || busy) return;
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const minOut = await executeTrade(cfg, quote, setProgress);
      const n = toNumber(minOut, outDecimals);
      setDone({ out: n, currency: quote.payWith });
      setAmount("");
      onTraded?.(n, quote.payWith);
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setProgress(null);
      setBusy(false);
      resetSwapConfig();
      setCfgSeq((n) => n + 1);
    }
  }

  const fallbackUrl = env.buyVspUrl;
  const impactPct = quote ? quote.priceImpactBps / 100 : null;
  // A drained or far-too-shallow pool shows up as a huge impact; never let that trade through.
  const tooShallow = impactPct != null && impactPct > IMPACT_BLOCK_PCT;
  const canSubmit = !!quote && !busy && !overMax && !tooShallow;

  if (unavailable) {
    return (
      <>
        <div style={sub}>{unavailable}</div>
        <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" style={linkBtn}>
          {side === "buy" ? "Buy" : "Sell"} VSP in the app →
        </a>
      </>
    );
  }
  if (!cfg || usdc == null) {
    return (
      <div style={{ ...sub, display: "flex", alignItems: "center", gap: 8 }}>
        Checking this wallet <Dots color={tokens.brand} />
      </div>
    );
  }
  if (!canTrade) {
    return (
      <>
        <div style={sub}>{blockedMessage(side, balances, env.minAvaxForGas)}</div>
        <div style={balanceRow}>
          <span>AVAX {fmtAmount(balances.avax)}</span>
          <span>USDC {fmtAmount(balances.usdc, 2)}</span>
          <span>VSP {fmtAmount(balances.vsp, 2)}</span>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={sub}>
        {side === "buy" ? "Buy VSP here, from your wallet, on the public pool. Pay with:" : "Sell VSP here, from your wallet, on the public pool. Receive:"}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {options.map((o) => (
          <button
            key={o.currency}
            onClick={() => {
              setCurrency(o.currency);
              setAmount("");
            }}
            disabled={!o.enabled || busy}
            title={o.reason}
            style={chip(currency === o.currency, o.enabled)}
          >
            {o.currency}
            {side === "buy" && (
              <span style={{ fontWeight: 500, opacity: 0.8, marginLeft: 6 }}>
                {o.currency === "AVAX" ? fmtAmount(balances.avax) : fmtAmount(balances.usdc, 2)}
              </span>
            )}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          placeholder={`Amount in ${inLabel}`}
          value={amount}
          disabled={busy}
          onChange={(e) => setAmount(e.target.value)}
          style={input}
        />
        <button
          onClick={() => setAmount(String(max))}
          disabled={busy}
          style={smallBtn}
          title={side === "buy" && currency === "AVAX" ? "Balance minus a reserve for gas" : "Whole balance"}
        >
          Max
        </button>
      </div>

      <div style={{ minHeight: 30, marginTop: 6, fontSize: 11, color: tokens.muted }}>
        {overMax ? (
          <span style={{ color: tokens.challenge }}>
            More than this wallet can {side === "buy" ? "spend" : "sell"}
            {side === "buy" && currency === "AVAX" ? " (gas reserve kept back)" : ""}.
          </span>
        ) : quoting ? (
          <span>Getting a quote…</span>
        ) : quoteErr ? (
          <span style={{ color: tokens.challenge }}>{quoteErr}</span>
        ) : quote && impactPct != null ? (
          <>
            <div style={{ color: tokens.ink }}>
              <strong style={{ fontWeight: 500 }}>
                {fmtAmount(quote.amountInHuman)} {quote.symbolIn}
              </strong>
              {" → "}
              <strong>
                ≈ {fmtAmount(quote.amountOutHuman)} {quote.symbolOut}
              </strong>
              <span style={{ color: impactPct > IMPACT_WARN_PCT ? tokens.challenge : tokens.muted }}>
                {" · "}
                {impactPct.toFixed(2)}% price impact
              </span>
              <span>
                {" · "}
                {(quote.feeBps / 100).toFixed(1)}% pool fee{quote.hops > 1 ? ` (${quote.hops} hops via USDC)` : ""}
              </span>
            </div>
            {tooShallow && (
              <div style={{ color: tokens.challenge, fontWeight: 600 }}>
                The pool is too shallow for this trade — it would lose more than {IMPACT_BLOCK_PCT}% to price impact.
              </div>
            )}
            <div>
              Min. received {fmtAmount(quote.minOutHuman)} {quote.symbolOut} ({(quote.slippageBps / 100).toFixed(1)}% slippage)
              {quote.steps > 1 &&
                ` · 2 confirmations this once: approve ${side === "buy" ? "USDC" : "VSP"} for the router, then swap`}
              {quote.steps === 1 && " · 1 confirmation"}
            </div>
          </>
        ) : (
          <span>
            {side === "buy" ? `Enter how much ${inLabel} to spend.` : "Enter how much VSP to sell."} Gas is paid in AVAX.
          </span>
        )}
      </div>

      <button onClick={trade} disabled={!canSubmit} style={{ ...primary, opacity: canSubmit ? 1 : 0.6 }}>
        {busy
          ? progressLabel(progress, side, currency)
          : quote
            ? side === "buy"
              ? `Buy ≈ ${fmtAmount(quote.amountOutHuman)} VSP`
              : `Sell for ≈ ${fmtAmount(quote.amountOutHuman)} ${outLabel}`
            : side === "buy"
              ? "Buy VSP"
              : "Sell VSP"}
      </button>

      {done && (
        <div style={{ marginTop: 8, fontSize: 12, color: tokens.support, fontWeight: 600 }}>
          {side === "buy" ? `Bought at least ${fmtAmount(done.out)} VSP.` : `Sold. Received at least ${fmtAmount(done.out)} ${done.currency}.`}
        </div>
      )}
      {err && <div style={errBox}>{err}</div>}

      <div style={{ marginTop: 8, fontSize: 11, color: tokens.faint }}>
        Prefer the app?{" "}
        <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" style={{ color: tokens.brand }}>
          Open Verisphere ↗
        </a>
      </div>
    </>
  );
}

function progressLabel(p: TradeProgress | null, side: TradeSide, currency: Currency | null): string {
  if (!p) return "Preparing…";
  const what =
    p.step === "approve" ? `Approve ${side === "buy" ? "USDC" : "VSP"}` : side === "buy" ? `Buy VSP with ${currency ?? ""}` : `Sell VSP for ${currency ?? ""}`;
  const phase = p.phase === "sign" ? "sign in wallet…" : "confirming…";
  return p.total > 1 ? `${p.index}/${p.total} ${what} · ${phase}` : `${what} · ${phase}`;
}

const sub: React.CSSProperties = { fontSize: 12, color: tokens.muted, marginBottom: 10 };
const balanceRow: React.CSSProperties = { display: "flex", gap: 12, fontSize: 11, color: tokens.faint };
const input: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "7px 8px",
  fontSize: 13,
  fontWeight: 600,
  color: tokens.ink,
  border: `1px solid ${tokens.line}`,
  borderRadius: 8,
  background: tokens.surface,
};
const smallBtn: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 8,
  border: `1px solid ${tokens.line}`,
  background: tokens.surface,
  color: tokens.ink,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const primary: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: tokens.brand,
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
const linkBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "7px 14px",
  borderRadius: 8,
  background: tokens.brand,
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  textDecoration: "none",
};
const errBox: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: tokens.challenge,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 6,
  padding: "6px 8px",
};
function chip(selected: boolean, enabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${selected ? tokens.brand : tokens.line}`,
    background: selected ? "#e0e7ff" : tokens.surface,
    color: enabled ? tokens.ink : tokens.faint,
    fontSize: 12,
    fontWeight: 700,
    cursor: enabled ? "pointer" : "not-allowed",
    textAlign: "left",
  };
}
