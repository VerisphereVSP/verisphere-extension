// patch_ext_standing_allowance — node:test (Node ≥ 22.18 strips types natively: `npm test`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { STANDING_STAKE_WEI, POSTING_FEE_MULTIPLE, allowanceCovers, standingPermitValue, permitKind } from "../src/wallet/allowance.ts";

const VSP = 10n ** 18n;
const SE = "0x19862B3790e455d88920630Bbc4012A0F195D7C9";
const PR = "0xe891773015730A9d688579E26D19478B54F1b9E4";
const addrs = { stakeEngine: SE.toLowerCase(), postRegistry: PR.toLowerCase() };

test("stake permits are standing: 10,000 VSP, or twice the stake when larger", () => {
  assert.equal(standingPermitValue("stake", 100n * VSP), STANDING_STAKE_WEI);
  assert.equal(standingPermitValue("stake", 10_000n * VSP), 20_000n * VSP);
  assert.equal(standingPermitValue("stake", 0n), 0n);
});

test("posting permits cover 100 posts", () => {
  assert.equal(standingPermitValue("posting", 1n * VSP), 100n * VSP);
  assert.equal(POSTING_FEE_MULTIPLE, 100n);
});

test("an unknown spender is permitted the exact amount (unchanged behaviour)", () => {
  assert.equal(standingPermitValue("other", 7n * VSP), 7n * VSP);
});

test("a permit is only asked for when the allowance does not cover the action", () => {
  assert.equal(allowanceCovers(10_000n * VSP, 50n * VSP), true);
  assert.equal(allowanceCovers(40n * VSP, 50n * VSP), false);
  assert.equal(allowanceCovers(0n, 0n), true);
});

test("spender classification is case-insensitive and falls back to other", () => {
  assert.equal(permitKind(SE, addrs), "stake");
  assert.equal(permitKind(PR.toUpperCase().replace("0X", "0x"), addrs), "posting");
  assert.equal(permitKind("0x6b23ffeca4378be332e424bff653d534214b2b96", addrs), "other");
});
