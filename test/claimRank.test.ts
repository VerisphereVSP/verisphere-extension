// Multi-claim sentences: which claim the underline shows, and the order the chooser lists them in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankGroups } from "../src/content/claimRank.ts";
import type { ClaimGroup } from "../src/shared/types.ts";

const claim = (postId: number, support: number, challenge: number) => ({
  postId, text: "", evs: 0, baseVs: 0, supportStake: support, challengeStake: challenge,
  totalStake: support + challenge, active: true, incomingCount: 0, outgoingCount: 0,
});
const group = (id: string, c?: ReturnType<typeof claim>): ClaimGroup => ({
  groupId: id, canonicalText: id, sentenceIds: ["p1s1"], status: c ? "mapped" : "eligible", claim: c,
});

test("the most-staked on-chain claim comes first", () => {
  const flooding = group("flooding", claim(1, 2, 0));
  const heat = group("heat", claim(2, 10, 5));
  assert.deepEqual(rankGroups([flooding, heat]).map((g) => g.groupId), ["heat", "flooding"]);
});

test("on-chain claims rank above ones not created yet, whatever the order given", () => {
  const draft = group("draft");
  const live = group("live", claim(3, 0.5, 0));
  assert.deepEqual(rankGroups([draft, live]).map((g) => g.groupId), ["live", "draft"]);
});

test("ties keep the resolver's order (stable)", () => {
  const a = group("a", claim(1, 1, 0));
  const b = group("b", claim(2, 1, 0));
  const c = group("c", claim(3, 1, 0));
  assert.deepEqual(rankGroups([b, a, c]).map((g) => g.groupId), ["b", "a", "c"]);
  assert.deepEqual(rankGroups([]), []);
});
