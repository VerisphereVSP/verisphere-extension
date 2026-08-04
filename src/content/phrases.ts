/**
 * Extract salient phrases from a Wikipedia article for candidate claim lookup.
 *
 * These are the concepts the gateway searches its claim corpus for (full-text),
 * so we want curated, high-signal terms rather than raw prose: the article
 * title, wikilink anchor texts (Wikipedia's own key-concept markup), and
 * section headings. Cheap, local, and computed once per page load.
 */

const MAX_PHRASES = 100;

export function extractPhrases(): string[] {
  const out = new Set<string>();

  const title = document.querySelector("#firstHeading")?.textContent?.trim();
  if (title) out.add(title);

  const root =
    document.querySelector("#mw-content-text .mw-parser-output") ??
    document.querySelector("#mw-content-text") ??
    document.body;

  // Wikilink anchor texts — the concepts the article's editors chose to link.
  // Skip namespaced/section links (File:, Help:, #cite_note, ...).
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="/wiki/"]'))) {
    const href = a.getAttribute("href") ?? "";
    if (/[:#]/.test(href)) continue;
    const t = a.textContent?.trim();
    if (t && t.length >= 3 && t.length <= 60) out.add(t);
    if (out.size >= MAX_PHRASES) return [...out];
  }

  // Section headings.
  for (const h of Array.from(root.querySelectorAll<HTMLElement>("h2, h3"))) {
    const t = h.textContent?.replace(/\[edit\]/gi, "").trim();
    if (t && t.length >= 3 && t.length <= 60) out.add(t);
    if (out.size >= MAX_PHRASES) break;
  }

  return [...out];
}
