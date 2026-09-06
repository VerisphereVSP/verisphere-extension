import { createRoot } from "react-dom/client";
import { api } from "../api";
import { extractSentences } from "./sentences";
import { extractPhrases } from "./phrases";
import { injectMarkStyles, paint } from "./highlighter";
import { groups, hooks, page, pageStatus, records, type SentenceRecord } from "./store";
import type { ArticleResolveResult } from "../shared/types";
import { wallet } from "../wallet/wallet";
import { Overlay } from "./overlay";
import { tokens } from "../shared/tokens";

/**
 * Content-script entry. Runs on Wikipedia article pages.
 *
 * Matching is LAZY and paragraph-batched: we extract every sentence up front
 * (cheap, local) plus a set of salient phrases (title, wikilinks, headings),
 * then locate on-chain claims in paragraphs as they scroll into view — an
 * IntersectionObserver queues visible paragraphs and a settle debounce flushes
 * their sentences to the gateway, which looks up candidate claims by phrase and
 * locates them with a local vector search. Marks paint additively as batches
 * resolve; groups merge across batches by group id.
 */

interface Paragraph {
  paragraphId: string;
  el: HTMLElement;
  sentences: { sentenceId: string; text: string; flagged?: boolean; el: HTMLElement; start: number; end: number }[];
  state: "idle" | "requested" | "done";
}

// Wait for the viewport to stop moving before flushing. Generous on purpose:
// scrolling straight through the article would otherwise analyze every
// paragraph it passes (wasted LLM spend) instead of only where the reader
// settles.
const SETTLE_MS = 1000;
// Smaller batches return (and paint) sooner, so claims appear progressively
// instead of the whole viewport blocking on its slowest paragraph.
const MAX_BATCH_SENTENCES = 40;

async function boot() {
  // Honor the popup on/off toggle.
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled === false) {
    console.log("[Verisphere] overlay disabled via popup");
    return;
  }
  console.log("[Verisphere] content script loaded on", location.href);
  // Mount the overlay unconditionally so the launcher is always a proof of
  // life, even if this page's markup yields no extractable sentences.
  injectMarkStyles();
  mountOverlay();
  // Silently restore a prior wallet session (no prompt) so a page refresh
  // doesn't demand a reconnect.
  void wallet.restore();

  const raw = extractSentences();
  console.log(`[Verisphere] extracted ${raw.length} sentences`);
  if (raw.length === 0) return;

  // Salient phrases (title, wikilink anchors, headings) — computed once and
  // sent with every batch so the gateway can look up candidate claims.
  const phrases = extractPhrases();
  console.log(`[Verisphere] extracted ${phrases.length} salient phrases`);

  // Group sentences by paragraph — the lazy-load + server-cache unit.
  const paragraphs: Paragraph[] = [];
  const byEl = new Map<HTMLElement, Paragraph>();
  for (const s of raw) {
    let p = byEl.get(s.el);
    if (!p) {
      p = { paragraphId: s.sentenceId.replace(/s\d+$/, ""), el: s.el, sentences: [], state: "idle" };
      byEl.set(s.el, p);
      paragraphs.push(p);
    }
    p.sentences.push(s);
  }
  const revisionId = extractRevisionId();

  let inflight = 0;
  function setStatus(error: string | null = pageStatus.error) {
    pageStatus.loading = inflight > 0;
    pageStatus.error = error;
    document.dispatchEvent(new CustomEvent("verisphere:ready"));
  }

  // Per-paragraph in-flight promises so the on-demand path can await a batch
  // that's already running instead of falling back to the raw-text flow.
  const inflightBatches = new Map<Paragraph, Promise<void>>();

  function requestBatch(batch: Paragraph[]): Promise<void> {
    const promise = runBatch(batch);
    batch.forEach((p) => inflightBatches.set(p, promise));
    void promise.finally(() => batch.forEach((p) => inflightBatches.delete(p)));
    return promise;
  }

  async function runBatch(batch: Paragraph[]): Promise<void> {
    batch.forEach((p) => (p.state = "requested"));
    inflight++;
    setStatus(null);
    try {
      const sentences = batch.flatMap((p) => p.sentences.map((s) => ({ sentenceId: s.sentenceId, text: s.text })));
      const res = await api.resolveArticle({
        url: page.url,
        title: page.title.replace(/ - Wikipedia$/, ""),
        revisionId,
        phrases,
        sentences,
      });
      ingest(res, batch);
      batch.forEach((p) => {
        p.state = "done";
        io.unobserve(p.el);
      });
    } catch (e) {
      // Back to idle: the paragraphs re-queue on the next scroll/settle.
      batch.forEach((p) => (p.state = "idle"));
      console.warn("[Verisphere] paragraph batch failed:", e);
      setStatus(e instanceof Error ? e.message : "Analysis failed");
      return;
    } finally {
      inflight--;
      setStatus();
    }
  }

  /** Merge a batch's matched claims into the store and paint its sentences. */
  function ingest(res: ArticleResolveResult, batch: Paragraph[]) {
    for (const g of res.groups) {
      const existing = groups.get(g.groupId);
      if (!existing) {
        groups.set(g.groupId, { ...g });
      } else {
        for (const id of g.sentenceIds) {
          if (!existing.sentenceIds.includes(id)) existing.sentenceIds.push(id);
        }
        // Fresher on-chain data wins (scores move between batches).
        if (g.claim) {
          existing.claim = g.claim;
          existing.status = g.status;
          existing.matchScore = g.matchScore;
        }
      }
    }

    // Each sentence maps to at most one matched claim; unmatched = fluff.
    const groupBySentence = new Map<string, string>();
    for (const g of res.groups) {
      for (const id of g.sentenceIds) groupBySentence.set(id, g.groupId);
    }

    const recs: SentenceRecord[] = [];
    for (const p of batch) {
      for (const s of p.sentences) {
        const gid = groupBySentence.get(s.sentenceId);
        const g = gid ? groups.get(gid) : undefined;
        if (!g) {
          recs.push({ ...s, status: "none" }); // no matching claim
          continue;
        }
        // One claim per sentence: a matched sentence points to its claim and
        // underlines in full.
        recs.push({
          ...s,
          status: g.status,
          claim: g.claim,
          matchScore: g.matchScore,
          groupId: g.groupId,
          canonicalText: g.canonicalText,
        });
      }
    }
    for (const rec of recs) records.set(rec.sentenceId, rec);
    paint(recs);
  }

  // ── Viewport loop: queue visible paragraphs, flush on settle ─────────────
  const queue = new Set<Paragraph>();
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    const pending = [...queue].filter((p) => p.state === "idle");
    queue.clear();
    // Chunk so one flush can't produce an oversized request.
    let batch: Paragraph[] = [];
    let count = 0;
    for (const p of pending) {
      if (count + p.sentences.length > MAX_BATCH_SENTENCES && batch.length > 0) {
        void requestBatch(batch);
        batch = [];
        count = 0;
      }
      batch.push(p);
      count += p.sentences.length;
    }
    if (batch.length > 0) void requestBatch(batch);
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const p = byEl.get(e.target as HTMLElement);
        if (p && p.state === "idle") queue.add(p);
      }
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(flush, SETTLE_MS);
    },
    // Modest prefetch below the fold. A large margin pulls the whole first
    // screen-plus into the very first batch, delaying first paint; keep it
    // tight so the visible paragraphs analyze first, then the next ones as
    // they approach.
    { rootMargin: "200px 0px" },
  );
  paragraphs.forEach((p) => io.observe(p.el));

  // On-demand path: a selection landed in a paragraph the lazy loader hasn't
  // reached (or one that's mid-flight). Analyze it now / wait for it.
  hooks.analyzeParagraph = async (el: HTMLElement) => {
    const p = byEl.get(el);
    if (!p) return;
    if (p.state === "requested") return inflightBatches.get(p);
    if (p.state === "idle") return requestBatch([p]);
  };
}

/** Wikipedia embeds the revision id in an inline RLCONF script in <head>. */
function extractRevisionId(): string | null {
  for (const script of Array.from(document.scripts)) {
    const m = /"wgRevisionId":\s*(\d+)/.exec(script.textContent ?? "");
    if (m) return m[1];
  }
  return null;
}

function mountOverlay() {
  const host = document.createElement("div");
  host.id = "verisphere-root";
  host.style.all = "initial";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ${tokens.font}; }
    button { font-family: inherit; }
    @keyframes vr-spin { to { transform: rotate(360deg); } }
    @keyframes vr-pulse { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  `;
  shadow.appendChild(style);

  const container = document.createElement("div");
  shadow.appendChild(container);
  createRoot(container).render(<Overlay />);
}

boot();
