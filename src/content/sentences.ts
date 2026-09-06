import type { SentenceRecord } from "./store";

/**
 * Extract candidate sentences from a Wikipedia article body.
 *
 * We walk the lead + body paragraphs inside `.mw-parser-output`, split each
 * paragraph into sentences with their char offsets (so the highlighter can map
 * a sentence back to a DOM range), and flag paragraphs that carry a
 * "citation needed" / "disputed" marker (our priority create/stake targets).
 */

// With lazy per-paragraph analysis there's no per-request cost to extracting
// the whole article; this is just a safety cap for pathological pages.
const MAX_SENTENCES = 1500;
// Sentence boundary: .!? optionally followed by citation markers like [56]
// (without tolerating those, "coverage.[56] Between" never splits and two
// sentences travel as one), then whitespace before a capital/quote/paren.
const SENTENCE_SPLIT = /(?<=[.!?](?:\[[^\]]*\])*)\s+(?=[A-Z0-9"“(])/;

export function extractSentences(): Omit<SentenceRecord, "status">[] {
  // Try progressively broader selectors — Wikipedia skins (Vector 2022,
  // legacy, mobile) nest the parser output differently.
  const paras = pickParagraphs();
  if (paras.length === 0) {
    console.warn("[Verisphere] extractor found no <p> elements to scan");
    return [];
  }

  const out: Omit<SentenceRecord, "status">[] = [];
  let pIndex = 0;
  for (const p of paras) {
    if (out.length >= MAX_SENTENCES) break;
    // Skip empty/structural paragraphs.
    const text = p.textContent ?? "";
    if (text.trim().length < 30) {
      pIndex++;
      continue;
    }
    const flaggedPara = /\[(citation needed|disputed|dubious)\b/i.test(text);

    let cursor = 0;
    const parts = text.split(SENTENCE_SPLIT);
    let sIndex = 0;
    for (const raw of parts) {
      const start = text.indexOf(raw, cursor);
      if (start < 0) continue;
      const end = start + raw.length;
      cursor = end;
      const clean = raw.trim();
      if (clean.length < 25) {
        sIndex++;
        continue;
      }
      out.push({
        sentenceId: `p${pIndex}s${sIndex}`,
        text: stripRefs(clean),
        flagged: flaggedPara,
        el: p,
        start,
        end,
      });
      sIndex++;
      if (out.length >= MAX_SENTENCES) break;
    }
    pIndex++;
  }
  return out;
}

/** Pick the best set of body paragraphs, trying several selectors and keeping
 *  whichever yields the most. Logs what it found for debugging. */
function pickParagraphs(): HTMLElement[] {
  const selectors = [
    "#mw-content-text .mw-parser-output p",
    ".mw-parser-output p",
    "#mw-content-text p",
    "#bodyContent p",
    "main p",
    "p",
  ];
  let best: HTMLElement[] = [];
  const counts: Record<string, number> = {};
  for (const sel of selectors) {
    const found = Array.from(document.querySelectorAll<HTMLElement>(sel));
    counts[sel] = found.length;
    if (found.length > best.length) best = found;
    if (best.length > 0 && sel !== "p") break; // first non-empty scoped hit wins
  }
  console.log("[Verisphere] paragraph selectors:", counts);
  return best;
}

/** Remove inline citation markers like [1], [23], [citation needed] from the
 *  text we send to the backend (offsets still reference the raw textContent). */
function stripRefs(s: string): string {
  return s.replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
}
