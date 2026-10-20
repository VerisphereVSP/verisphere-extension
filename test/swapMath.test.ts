// In-panel VSP trading — pure eligibility helpers (swapMath.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAS_RESERVE_AVAX,
  IMPACT_BLOCK_PCT,
  IMPACT_WARN_PCT,
  blockedMessage,
  buyOptions,
  maxSpend,
  parseAmount,
  sellOptions,
  toNumber,
} from "../src/wallet/swapMath.ts";

const MIN_GAS = 0.01;
const enabled = (opts: { enabled: boolean }[]) => opts.map((o) => o.enabled);

test("parseAmount accepts plain positive decimals only", () => {
  assert.equal(parseAmount("1.5"), 1.5);
  assert.equal(parseAmount(".5"), 0.5);
  assert.equal(parseAmount(" 10 "), 10);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("-1"), null);
  assert.equal(parseAmount("1e3"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(toNumber(1_500_000n, 6), 1.5);
});

test("buy: a wallet with nothing can't buy; the message says what to send", () => {
  const b = { avax: 0, usdc: 0, vsp: 0 };
  assert.deepEqual(enabled(buyOptions(b, MIN_GAS)), [false, false]);
  assert.match(blockedMessage("buy", b, MIN_GAS), /no AVAX or USDC/);
});

test("buy: USDC without AVAX is blocked — every swap is a gas-paying transaction", () => {
  const b = { avax: 0, usdc: 25, vsp: 0 };
  const [avax, usdc] = buyOptions(b, MIN_GAS);
  assert.equal(avax.enabled, false);
  assert.equal(usdc.enabled, false);
  assert.match(usdc.reason ?? "", /AVAX for gas/);
  assert.match(blockedMessage("buy", b, MIN_GAS), /USDC but no AVAX/);
});

test("buy: AVAX only pays with AVAX, keeping the gas reserve back", () => {
  const b = { avax: 0.5, usdc: 0, vsp: 0 };
  const [avax, usdc] = buyOptions(b, MIN_GAS);
  assert.equal(avax.enabled, true);
  assert.equal(usdc.enabled, false);
  assert.ok(Math.abs(maxSpend("buy", "AVAX", b) - (0.5 - GAS_RESERVE_AVAX)) < 1e-12);
});

test("buy: a little AVAX plus USDC offers USDC only", () => {
  const b = { avax: 0.015, usdc: 5, vsp: 0 };
  const [avax, usdc] = buyOptions(b, MIN_GAS);
  assert.equal(avax.enabled, false);
  assert.match(avax.reason ?? "", /gas/);
  assert.equal(usdc.enabled, true);
  assert.equal(maxSpend("buy", "USDC", b), 5);
});

test("buy: both funded, both offered; a route the venue lacks is disabled with a reason", () => {
  const b = { avax: 61.5, usdc: 100, vsp: 0 };
  assert.deepEqual(enabled(buyOptions(b, MIN_GAS)), [true, true]);
  const [avax] = buyOptions(b, MIN_GAS, { AVAX: false, USDC: true });
  assert.equal(avax.enabled, false);
  assert.match(avax.reason ?? "", /route/);
});

test("sell: needs VSP and gas; the whole VSP balance can be sold", () => {
  assert.deepEqual(enabled(sellOptions({ avax: 1, usdc: 0, vsp: 0 }, MIN_GAS)), [false, false]);
  assert.match(blockedMessage("sell", { avax: 1, usdc: 0, vsp: 0 }, MIN_GAS), /no VSP/);
  const noGas = sellOptions({ avax: 0, usdc: 0, vsp: 50 }, MIN_GAS);
  assert.deepEqual(enabled(noGas), [false, false]);
  assert.match(noGas[0].reason ?? "", /AVAX for gas/);
  assert.deepEqual(enabled(sellOptions({ avax: 0.05, usdc: 0, vsp: 50 }, MIN_GAS)), [true, true]);
  assert.deepEqual(enabled(sellOptions({ avax: 0.05, usdc: 0, vsp: 50 }, MIN_GAS, { AVAX: false, USDC: true })), [false, true]);
  assert.equal(maxSpend("sell", "AVAX", { avax: 0.05, usdc: 0, vsp: 50 }), 50);
});

test("the hard impact stop sits well above the warning", () => {
  assert.ok(IMPACT_WARN_PCT < IMPACT_BLOCK_PCT);
});
