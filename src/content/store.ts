import type { Claim, ClaimGroup, SentenceMatch } from "../shared/types";

/**
 * Shared in-memory state for the content script. Both the light-DOM highlighter
 * (index.tsx) and the shadow-DOM React overlay run in the same content-script
 * context, so a module singleton is the simplest bridge between them.
 */

/** A sentence occurrence located in the page, plus its resolved claim state. */
export interface SentenceRecord extends SentenceMatch {
  /** Paragraph element the sentence lives in. */
  el: HTMLElement;
  /** Char offsets of the whole sentence within `el.textContent`. */
  start: number;
  end: number;
  /**
   * Optional char offsets (within `el.textContent`) of just this claim's
   * fragment of the sentence — set when the sentence expresses multiple claims,
   * so the mark underlines only the relevant clause. Falls back to start/end.
   */
  claimStart?: number;
  claimEnd?: number;
  /** Selection touched only fluff — panel shows the no-claim empty state. */
  fluffNotice?: boolean;
  /**
   * Launcher opened with no on-chain claims on the page — the panel shows a
   * "select a claim to begin" prompt instead of any claim/create UI.
   */
  emptyNotice?: boolean;
  /**
   * Selection touched several claims — groupIds to choose between (best
   * selection-affinity first). The panel renders a chooser instead of
   * create/stake until one is picked.
   */
  choices?: string[];
  /** The `choices` are ALL of the page's claims (launcher list view). */
  listAll?: boolean;
}

export const records = new Map<string, SentenceRecord>();

/** Canonical claim groups for this page (groupId → group). */
export const groups = new Map<string, ClaimGroup>();

/** Resolution lifecycle, surfaced by the launcher pill. */
export const pageStatus: { loading: boolean; error: string | null } = {
  loading: false,
  error: null,
};

/**
 * On-demand analysis of a single paragraph (set by the boot code once the
 * paragraph index exists). The overlay uses it when a selection lands in a
 * paragraph the lazy loader hasn't reached yet.
 */
export const hooks: {
  analyzeParagraph: ((el: HTMLElement) => Promise<void>) | null;
} = { analyzeParagraph: null };

/** All painted sentence ids belonging to a group (page order). */
export function groupSentenceIds(groupId: string): string[] {
  return groups.get(groupId)?.sentenceIds.filter((id) => records.has(id)) ?? [];
}

/**
 * Attach a claim to a whole group (after create/stake): updates the group and
 * every member sentence record. Returns the member ids so callers can repaint.
 */
export function applyClaimToGroup(groupId: string, claim: Claim): string[] {
  const group = groups.get(groupId);
  if (!group) return [];
  group.claim = claim;
  group.status = claim.active ? "mapped" : "low-liquidity";
  const ids = groupSentenceIds(groupId);
  for (const id of ids) {
    const r = records.get(id);
    if (r) {
      r.claim = claim;
      r.status = group.status;
    }
  }
  return ids;
}

/** Which side a create-from-selection was seeded with (Support/Challenge pill). */
export type StakeSide = "support" | "challenge";
export const createIntents = new Map<string, StakeSide>();

export const page = { url: location.href, title: document.title };

/** Simple typed event bus over DOM CustomEvents (namespaced verity:*). */
export type Bus = {
  hover: { sentenceId: string };
  hoverEnd: {};
  open: { sentenceId: string };
  create: { sentenceId: string; text: string };
};

export function emit<K extends keyof Bus>(type: K, detail: Bus[K]) {
  document.dispatchEvent(new CustomEvent(`verity:${type}`, { detail }));
}

export function on<K extends keyof Bus>(type: K, cb: (d: Bus[K]) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail);
  document.addEventListener(`verity:${type}`, handler);
  return () => document.removeEventListener(`verity:${type}`, handler);
}
