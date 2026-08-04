/**
 * Locate the character span within a sentence that a specific claim came from,
 * so a multi-claim sentence underlines only the relevant fragment.
 *
 * Canonical claim text is reworded (e.g. "Present-day climate change includes
 * global warming, the ongoing increase in global average temperature"), so we
 * can't match it verbatim. Instead we use each claim's DISTINCTIVE words — the
 * content words it has that its sibling claims in the same sentence do NOT —
 * and take the span from the first to the last distinctive word in the source.
 * Shared subjects ("Present-day climate change includes …") cancel out, so two
 * claims that share a subject still resolve to different fragments.
 *
 * Returns [start, end) offsets RELATIVE TO `rawSentence`, or null when it can't
 * confidently locate a fragment (caller then falls back to the whole sentence).
 */
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

function wordSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.toLowerCase().matchAll(WORD_RE)) if (m[0].length >= 2) out.add(m[0]);
  return out;
}

export function claimFragmentSpan(
  rawSentence: string,
  targetCanonical: string,
  siblingCanonicals: string[],
): [number, number] | null {
  if (!rawSentence || !targetCanonical || siblingCanonicals.length === 0) return null;

  const target = wordSet(targetCanonical);
  const siblings = new Set<string>();
  for (const s of siblingCanonicals) for (const w of wordSet(s)) siblings.add(w);

  // Distinctive = words this claim has that its siblings don't.
  const distinctive = new Set<string>();
  for (const w of target) if (!siblings.has(w)) distinctive.add(w);
  if (distinctive.size === 0) return null;

  // Tokenize the source with citation markers masked (keeps offsets aligned).
  const masked = rawSentence.replace(/\[[^\]]*\]/g, (m) => " ".repeat(m.length));
  let min = Infinity;
  let max = -1;
  let hits = 0;
  for (const m of masked.matchAll(WORD_RE)) {
    if (!distinctive.has(m[0].toLowerCase())) continue;
    hits++;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (start < min) min = start;
    if (end > max) max = end;
  }
  // Need at least two anchored words so a single stray match can't mislocate.
  if (hits < 2 || max <= min) return null;
  return [min, max];
}
