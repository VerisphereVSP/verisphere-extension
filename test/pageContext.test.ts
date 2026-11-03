// patch_ext_claim_resolve: the paragraph handed to the resolver is the text around the claim, bounded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paragraphAround } from "../src/shared/pageContext.ts";

test("paragraphAround keeps a short paragraph whole and windows a long one around the claim", () => {
  assert.equal(paragraphAround("  The disease was  first identified in 2019. Early cases were linked to the market. ", "Early cases"), "The disease was first identified in 2019. Early cases were linked to the market.");
  const long = "x".repeat(2000) + " Early cases were linked to the Huanan market in Wuhan. " + "y".repeat(2000);
  const w = paragraphAround(long, "Early cases were linked to the Huanan market in Wuhan.", 400);
  assert.equal(w.length, 400);
  assert.ok(w.includes("Early cases were linked"));
  // claim not found: the head of the paragraph
  assert.equal(paragraphAround("a".repeat(900), "zzz", 100), "a".repeat(100));
});
