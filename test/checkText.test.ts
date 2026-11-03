// patch_ext_check / patch_ext_share: the pure parts of "Check on Verisphere" and sharing from the panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCheckText, phrasesFrom, handoffUrl, injectable, withInvitation } from "../src/shared/checkText.ts";

test("normalizeCheckText folds whitespace, refuses crumbs, bounds long selections on a word", () => {
  assert.equal(normalizeCheckText("  As of  August\n2021,\treinfection was uncommon. "), "As of August 2021, reinfection was uncommon.");
  assert.equal(normalizeCheckText("short"), null);
  assert.equal(normalizeCheckText(null), null);
  const long = normalizeCheckText("word ".repeat(200))!;
  assert.ok(long.length <= 601 && long.endsWith("…") && !long.includes("wor…"));
});

test("phrasesFrom keeps title + headings, cleaned and bounded", () => {
  const p = phrasesFrom(" Reinfection — Wikipedia ", ["Overview", "  Overview ", "x", null, "A".repeat(200), ...Array.from({ length: 30 }, (_, i) => `H${i} heading`)]);
  assert.equal(p[0], "Reinfection — Wikipedia");
  assert.equal(p.filter((x) => x === "Overview").length, 1);
  assert.ok(!p.includes("x") && !p.some((x) => x.length > 120));
  assert.ok(p.length <= 16);
});

test("handoffUrl lands in the app's Start sheet with the side when known", () => {
  assert.equal(handoffUrl("https://app.verisphere.co/", 49, "challenge"), "https://app.verisphere.co/claims?post=49&side=challenge&start=1");
  assert.equal(handoffUrl("https://app.verisphere.co", 49, null), "https://app.verisphere.co/claims?post=49&start=1");
});

test("injectable: web pages yes; chrome://, the store and nonsense no", () => {
  assert.ok(injectable("https://www.reddit.com/r/x/comments/1"));
  assert.ok(injectable("http://localhost:5173/claims"));
  assert.ok(!injectable("chrome://extensions"));
  assert.ok(!injectable("https://chromewebstore.google.com/detail/abc"));
  assert.ok(!injectable(undefined) && !injectable("not a url"));
});

test("withInvitation puts the code on the link and the invitation line above a trailing link", () => {
  const url = "https://app.verisphere.co/c/49";
  const text = `100 % of stake on Verisphere challenges it:\n“A claim.”\nAgree? Support it. Disagree? Challenge it.\n${url}`;
  const r = withInvitation(url, text, "VSP-AAAA-BBBB-CCCC", "2");
  assert.equal(r.url, `${url}?code=VSP-AAAA-BBBB-CCCC`);
  assert.deepEqual(r.text.split("\n").slice(-2), ["I've put 2 VSP on the table for you — the link carries it.", r.url]);
  assert.equal(withInvitation(url, `see ${url}`, "VSP-AAAA-BBBB-CCCC", "1").text, `see ${url}?code=VSP-AAAA-BBBB-CCCC I've put 1 VSP on the table for you — the link carries it.`);
});
