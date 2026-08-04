/**
 * Expand a text selection out to whole-sentence boundaries.
 *
 * If the user selects half a sentence we grab the whole sentence; if they
 * select 1.5 sentences we grab both. Works off the DOM Range: we locate the
 * selection's char offsets inside its containing block, then walk outward to
 * the nearest sentence boundaries.
 */

// A sentence boundary: .!? optionally followed by closing quotes/brackets AND
// Wikipedia citation markers like [52][53], then whitespace (or end of text for
// the forward scan). Without tolerating the citation markers, "bitcoins.[52] To"
// would fail to register as a boundary and snapping would over-run.
const TRAILERS = String.raw`(?:\[[^\]]*\]|["'”’)\]])*`;
const BACK_BOUNDARY = new RegExp(`[.!?]${TRAILERS}\\s+`, "g");
const FWD_BOUNDARY = new RegExp(`[.!?]${TRAILERS}(?=\\s|$)`, "g");

const MAX_EXPANDED = 800; // safety cap; beyond this fall back to the raw selection

/** Snapped-sentence text plus its position in the DOM (for painting a mark). */
export interface ExpandedSelection {
  text: string;
  el: HTMLElement;
  /** Char offsets of the snapped sentence within `el`'s raw textContent. */
  start: number;
  end: number;
  /** Char offsets of the user's LITERAL selection (before sentence snapping) —
   *  lets callers tell WHICH clause of a multi-claim sentence was meant. */
  rawStart: number;
  rawEnd: number;
}

/** Snap a selection to sentence boundaries, returning text + DOM position. */
export function expandToSentenceRange(sel: Selection): ExpandedSelection | null {
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);

  // Find a stable block element to use as sentence context.
  const node: Node | null = range.commonAncestorContainer;
  const el = node.nodeType === 3 ? node.parentElement : (node as Element);
  if (!el) return null;
  const block =
    (el.closest?.(
      "p, li, dd, dt, td, th, blockquote, figcaption, h1, h2, h3, h4, h5, h6",
    ) as HTMLElement | null) ?? (el as HTMLElement);

  const full = block.textContent ?? "";
  if (!full) return null;

  // Char offsets of the selection within block.textContent.
  const pre = document.createRange();
  pre.selectNodeContents(block);
  try {
    pre.setEnd(range.startContainer, range.startOffset);
  } catch {
    return null;
  }
  const startOffset = pre.toString().length;
  const endOffset = Math.min(startOffset + range.toString().length, full.length);

  // Walk back to the start of the sentence containing startOffset.
  let start = 0;
  const before = full.slice(0, startOffset);
  BACK_BOUNDARY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BACK_BOUNDARY.exec(before)) !== null) {
    start = m.index + m[0].length;
  }

  // Walk forward to the end of the sentence containing endOffset.
  let end = full.length;
  FWD_BOUNDARY.lastIndex = Math.max(0, endOffset - 1);
  const m2 = FWD_BOUNDARY.exec(full);
  if (m2) end = m2.index + m2[0].length;

  if (end - start > MAX_EXPANDED) return null; // too big — caller keeps raw text

  const text = full
    .slice(start, end)
    .replace(/\[[^\]]*\]/g, "") // strip [1], [citation needed]
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return { text, el: block, start, end, rawStart: startOffset, rawEnd: endOffset };
}

/** Text-only convenience wrapper. */
export function expandToSentences(sel: Selection): string | null {
  return expandToSentenceRange(sel)?.text ?? null;
}
