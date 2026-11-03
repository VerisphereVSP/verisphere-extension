// src/shared/pageContext.ts — patch_ext_claim_resolve
// The context a claim came from, for the resolver: the page title and the paragraph around the selection. Pure
// where it can be (node-testable); the DOM reader is a thin wrapper.
export interface ClaimContext { title?: string; paragraph?: string }

const MAX_PARAGRAPH = 1500;

/** The paragraph text trimmed around the claim so the resolver sees the sentences next to it, not a whole article. */
export function paragraphAround(paragraph: string, claim: string, max: number = MAX_PARAGRAPH): string {
  const p = paragraph.replace(/\s+/g, " ").trim();
  if (p.length <= max) return p;
  const i = p.indexOf(claim.slice(0, 40));
  if (i < 0) return p.slice(0, max);
  const start = Math.max(0, i - Math.floor(max / 2));
  return p.slice(start, start + max);
}

/** Title + the block element the selection sits in (or the record's element), as the resolver's context. */
export function contextFor(el: HTMLElement | null | undefined, claim: string, doc: Document = document): ClaimContext {
  const title = (doc.title || "").replace(/\s+/g, " ").trim().slice(0, 200) || undefined;
  let node: HTMLElement | null = el ?? null;
  // climb to a block that holds a paragraph's worth of text
  while (node && node !== doc.body && (node.textContent ?? "").trim().length < 80) node = node.parentElement;
  const raw = node && node !== doc.body ? node.textContent ?? "" : "";
  const paragraph = raw ? paragraphAround(raw, claim) : undefined;
  return { title, paragraph };
}
