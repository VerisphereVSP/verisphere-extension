// src/content/check.ts — patch_ext_check (extension 0.1.4)
// "Check on Verisphere": one piece of text from any page → the claims it states, or the offer to create one. Pure
// routing over the same store the Wikipedia flow uses, so the side panel needs no new views: one match opens the claim
// (stake view), several open the chooser, none opens the create view seeded with the text.
import { api } from "../api";
import { resolveClaim } from "../api/checks";  // patch_ext_check_resolve
import { contextFor } from "../shared/pageContext";
import { groups, records, page } from "./store";
import type { ClaimGroup } from "../shared/types";

export { normalizeCheckText, handoffUrl } from "../shared/checkText";
import { phrasesFrom } from "../shared/checkText";

/** The page's own words that help the app find candidate claims: title and headings, bounded. */
export function pagePhrases(doc: Document = document): string[] {
  return phrasesFrom(doc.title, Array.from(doc.querySelectorAll("h1, h2, h3")).map((h) => h.textContent));
}

export type CheckRoute =
  | { kind: "claim"; id: string; group: ClaimGroup }
  | { kind: "chooser"; id: string; groups: ClaimGroup[] }
  | { kind: "create"; id: string };

/** The text to locate: the selection made to stand alone from the page it sits in (patch_ext_check_resolve). "It was
 *  first identified in December 2019" on the COVID-19 article is located as "COVID-19 was first identified…"; when
 *  the page does not say, or the resolver is unreachable, the selection is located as written. */
export async function textToLocate(text: string, contextEl: HTMLElement | null | undefined): Promise<string> {
  try {
    const r = await resolveClaim(text, contextFor(contextEl, text));
    if (r.ok && !r.result.needs_context && r.result.resolved.trim()) return r.result.resolved.trim();
  } catch { /* locate the selection as written */ }
  return text;
}

/** Resolve the text against the app and write the record the panel will open. */
export async function checkText(text: string, opts: { phrases?: string[]; now?: () => number; contextEl?: HTMLElement | null } = {}): Promise<CheckRoute> {
  const id = `check-${(opts.now ?? Date.now)()}`;
  const located = await textToLocate(text, opts.contextEl);
  const res = await api.resolveArticle({
    url: page.url,
    title: page.title,
    revisionId: null,
    phrases: opts.phrases ?? pagePhrases(),
    sentences: [{ sentenceId: id, text: located }],
    check: true,
  });
  const found = res.groups.filter((g) => g.sentenceIds.includes(id) || res.groups.length === 1);
  for (const g of found) groups.set(g.groupId, { ...g });
  const base = { sentenceId: id, text, el: document.body, start: 0, end: 0, checked: true as const, contextEl: opts.contextEl ?? undefined };
  if (found.length === 1) {
    const g = found[0];
    records.set(id, { ...base, status: g.status, claim: g.claim, matchScore: g.matchScore, groupId: g.groupId, canonicalText: g.canonicalText });
    return { kind: "claim", id, group: g };
  }
  if (found.length > 1) {
    const ranked = [...found].sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    records.set(id, { ...base, status: "eligible", choices: ranked.map((g) => g.groupId) });
    return { kind: "chooser", id, groups: ranked };
  }
  records.set(id, { ...base, status: "eligible" });
  return { kind: "create", id };
}
