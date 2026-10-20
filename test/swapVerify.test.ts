// In-panel VSP trading — the server-built swap is verified field by field before signing (swapVerify.ts).
// The build/quote fixtures are real responses from test.verisphere.co (Fuji, Trader Joe v1 router) on 2026-10-18.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_SELECTORS,
  approveCalldata,
  expectedPath,
  expectedSelector,
  tokenIn,
  verifyPoolBuild,
  verifyRoutes,
  type PoolBuild,
  type PoolRoutes,
} from "../src/wallet/swapVerify.ts";
import { MAX_UINT256 } from "../src/wallet/swapMath.ts";

const USER = "0x02756B3aAa894d078842360715d6192E30213593";
const ROUTES: PoolRoutes = {
  configured: true,
  chainId: 43113,
  router: "0xd7f655e3376ce2d7a2b08ff01eb3b1023191a901",
  native: "AVAX",
  selectors: { swapExactNativeForTokens: "a2a1623d", swapExactTokensForNative: "676528d1", swapExactTokensForTokens: "38ed1739" },
  tokens: {
    wavax: "0xd00ae08403b9bbb9124bb305c09058e32c39a48c",
    usdc: "0x5425890298aed601595a70ab815c96711a31bc65",
    vsp: "0x6bb97027a88c5a1d7e5873943c415f8384c264e3",
  },
  routes: { AVAX: true, USDC: true },
  feeBpsPerHop: 30,
  defaultSlippageBps: 50,
  maxSlippageBps: 500,
  defaultDeadlineS: 1200,
};

const BUY_AVAX: PoolBuild = {
  to: "0xd7f655e3376ce2d7a2b08ff01eb3b1023191a901",
  data: "0xa2a1623d000000000000000000000000000000000000000000000000024a6cd772de099d000000000000000000000000000000000000000000000000000000000000008000000000000000000000000002756b3aaa894d078842360715d6192e30213593000000000000000000000000000000000000000000000000000000006ad5119e0000000000000000000000000000000000000000000000000000000000000003000000000000000000000000d00ae08403b9bbb9124bb305c09058e32c39a48c0000000000000000000000005425890298aed601595a70ab815c96711a31bc650000000000000000000000006bb97027a88c5a1d7e5873943c415f8384c264e3",
  value: "100000000000000000",
  fn: "swapExactAVAXForTokens",
  path: ["0xd00ae08403b9bbb9124bb305c09058e32c39a48c", "0x5425890298aed601595a70ab815c96711a31bc65", "0x6bb97027a88c5a1d7e5873943c415f8384c264e3"],
  amountIn: "100000000000000000",
  minOut: "165064008953366941",
  deadline: 1792348574,
  quote: {
    side: "buy", payWith: "AVAX",
    path: ["0xd00ae08403b9bbb9124bb305c09058e32c39a48c", "0x5425890298aed601595a70ab815c96711a31bc65", "0x6bb97027a88c5a1d7e5873943c415f8384c264e3"],
    amountIn: "100000000000000000", amountInHuman: 0.1, symbolIn: "AVAX", symbolOut: "VSP",
    amountOut: "165893476335042152", amountOutHuman: 0.16589347633504214, minOut: "165064008953366941", minOutHuman: 0.16506400895336695,
    priceImpactBps: 552, feeBps: 60, hops: 2, slippageBps: 50, native: "AVAX", router: "0xd7f655e3376ce2d7a2b08ff01eb3b1023191a901",
  },
};

const SELL_USDC: PoolBuild = {
  to: "0xd7f655e3376ce2d7a2b08ff01eb3b1023191a901",
  data: "0x38ed17390000000000000000000000000000000000000000000000008ac7230489e8000000000000000000000000000000000000000000000000000000000000001e9c5200000000000000000000000000000000000000000000000000000000000000a000000000000000000000000002756b3aaa894d078842360715d6192e30213593000000000000000000000000000000000000000000000000000000006ad5119f00000000000000000000000000000000000000000000000000000000000000020000000000000000000000006bb97027a88c5a1d7e5873943c415f8384c264e30000000000000000000000005425890298aed601595a70ab815c96711a31bc65",
  value: "0",
  fn: "swapExactTokensForTokens",
  path: ["0x6bb97027a88c5a1d7e5873943c415f8384c264e3", "0x5425890298aed601595a70ab815c96711a31bc65"],
  amountIn: "10000000000000000000",
  minOut: "2006098",
  deadline: 1792348575,
  quote: {
    side: "sell", payWith: "USDC",
    path: ["0x6bb97027a88c5a1d7e5873943c415f8384c264e3", "0x5425890298aed601595a70ab815c96711a31bc65"],
    amountIn: "10000000000000000000", amountInHuman: 10, symbolIn: "VSP", symbolOut: "USDC",
    amountOut: "2016179", amountOutHuman: 2.016179, minOut: "2006098", minOutHuman: 2.006098,
    priceImpactBps: 10, feeBps: 30, hops: 1, slippageBps: 50, native: "AVAX", router: "0xd7f655e3376ce2d7a2b08ff01eb3b1023191a901",
  },
  approve: { token: "0x6bb97027a88c5a1d7e5873943c415f8384c264e3", spender: "0xd7f655e3376ce2d7a2b08ff01eb3b1023191a901", amount: "10000000000000000000" },
};

const NOW = 1792348574 - 1200 + 5; // just after the server built these (deadline = now + 1200)

test("route table: real selectors pass, a swapped selector or a bad address fails", () => {
  verifyRoutes(ROUTES);
  assert.throws(() => verifyRoutes({ ...ROUTES, selectors: { ...ROUTES.selectors, swapExactNativeForTokens: "7ff36ab5" } }), /selector/);
  assert.throws(() => verifyRoutes({ ...ROUTES, tokens: { ...ROUTES.tokens, vsp: "0x12" } }), /address/);
  assert.throws(() => verifyRoutes({ ...ROUTES, configured: false }));
  assert.equal(KNOWN_SELECTORS.ETH.swapExactNativeForTokens, "7ff36ab5");
});

test("paths, selectors and the pulled token follow side and currency", () => {
  const { wavax, usdc, vsp } = ROUTES.tokens;
  assert.deepEqual(expectedPath(ROUTES, "buy", "AVAX"), [wavax, usdc, vsp]);
  assert.deepEqual(expectedPath(ROUTES, "buy", "USDC"), [usdc, vsp]);
  assert.deepEqual(expectedPath(ROUTES, "sell", "AVAX"), [vsp, usdc, wavax]);
  assert.deepEqual(expectedPath(ROUTES, "sell", "USDC"), [vsp, usdc]);
  assert.equal(expectedSelector(ROUTES, "buy", "AVAX"), "0xa2a1623d");
  assert.equal(expectedSelector(ROUTES, "sell", "AVAX"), "0x676528d1");
  assert.equal(expectedSelector(ROUTES, "sell", "USDC"), "0x38ed1739");
  assert.equal(expectedSelector({ ...ROUTES, native: "ETH" }, "buy", "AVAX"), "0x7ff36ab5");
  assert.equal(tokenIn(ROUTES, "buy", "AVAX"), null);
  assert.equal(tokenIn(ROUTES, "buy", "USDC"), usdc);
  assert.equal(tokenIn(ROUTES, "sell", "AVAX"), vsp);
});

test("a real Fuji build (buy 0.1 AVAX) verifies byte for byte: no approval, AVAX as value", () => {
  const v = verifyPoolBuild({ routes: ROUTES, side: "buy", currency: "AVAX", user: USER, amountHuman: 0.1, quote: BUY_AVAX.quote, build: BUY_AVAX, nowS: NOW });
  assert.equal(v.to, ROUTES.router);
  assert.equal(v.valueWei, 100_000_000_000_000_000n);
  assert.equal(v.minOut, 165_064_008_953_366_941n);
  assert.equal(v.approve, null);
});

test("a real Fuji build (sell 10 VSP for USDC) verifies and asks for the one-time max VSP approval", () => {
  const v = verifyPoolBuild({ routes: ROUTES, side: "sell", currency: "USDC", user: USER, amountHuman: 10, quote: SELL_USDC.quote, build: SELL_USDC, nowS: NOW });
  assert.equal(v.valueWei, 0n);
  assert.deepEqual(v.approve, { token: ROUTES.tokens.vsp, amount: MAX_UINT256 });
  assert.equal(approveCalldata(ROUTES.router, 5n).slice(0, 10), "0x095ea7b3");
});

test("tampered builds are refused", () => {
  const base = { routes: ROUTES, side: "buy" as const, currency: "AVAX" as const, user: USER, amountHuman: 0.1, quote: BUY_AVAX.quote, nowS: NOW };
  // recipient swapped inside the calldata
  const other = BUY_AVAX.data.replace("02756b3aaa894d078842360715d6192e30213593", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  assert.throws(() => verifyPoolBuild({ ...base, build: { ...BUY_AVAX, data: other } }), /calldata does not match/);
  // different router
  assert.throws(() => verifyPoolBuild({ ...base, build: { ...BUY_AVAX, to: "0x" + "1".repeat(40) } }), /router/);
  // path routed to another token
  assert.throws(() => verifyPoolBuild({ ...base, build: { ...BUY_AVAX, path: [BUY_AVAX.path[0], BUY_AVAX.path[1], "0x" + "2".repeat(40)] } }), /path/);
  // amount in not what the user typed
  assert.throws(() => verifyPoolBuild({ ...base, build: BUY_AVAX, amountHuman: 0.2 }), /amount in/);
  // AVAX value not equal to the amount
  assert.throws(() => verifyPoolBuild({ ...base, build: { ...BUY_AVAX, value: "1" } }), /value/);
  // deadline already passed / absurdly far
  assert.throws(() => verifyPoolBuild({ ...base, build: BUY_AVAX, nowS: BUY_AVAX.deadline + 1 }), /deadline/);
  assert.throws(() => verifyPoolBuild({ ...base, build: BUY_AVAX, nowS: BUY_AVAX.deadline - 100_000 }), /deadline/);
  // minimum out much worse than the quote the user saw
  const worse = { ...BUY_AVAX.quote, minOut: "200000000000000000" };
  assert.throws(() => verifyPoolBuild({ ...base, build: BUY_AVAX, quote: worse }), /price moved/);
  // and no transaction at all
  assert.throws(() => verifyPoolBuild({ ...base, build: undefined as unknown as PoolBuild }), /no transaction/);
  // approval attached to a native trade, or missing / wrong on a token trade
  assert.throws(() => verifyPoolBuild({ ...base, build: { ...BUY_AVAX, approve: SELL_USDC.approve } }), /approval/);
  const sellBase = { routes: ROUTES, side: "sell" as const, currency: "USDC" as const, user: USER, amountHuman: 10, quote: SELL_USDC.quote, nowS: NOW };
  assert.throws(() => verifyPoolBuild({ ...sellBase, build: { ...SELL_USDC, approve: undefined } }), /approval/);
  assert.throws(() => verifyPoolBuild({ ...sellBase, build: { ...SELL_USDC, approve: { ...SELL_USDC.approve!, spender: USER } } }), /approval/);
});
