import { useEffect, useMemo, useRef, useState } from "react";
import { on, records, groups, createIntents, pageStatus, hooks, type StakeSide, type SentenceRecord } from "./store";
import { markRect } from "./highlighter";
import { HoverCard } from "./components/HoverCard";
import { SidePanel } from "./components/SidePanel";
import { Launcher } from "./components/Launcher";
import { expandToSentenceRange } from "./sentenceSelection";
import { claimFragmentSpan } from "./claimFragment";
import { tokens } from "../shared/tokens";
import type { ClaimGroup } from "../shared/types";

interface SelPos {
  el: HTMLElement;
  start: number;
  end: number;
  /** The literal (un-snapped) selection offsets — disambiguate multi-claim sentences. */
  rawStart: number;
  rawEnd: number;
}

/** Root React app living in the shadow root: launcher + hover card + panel. */
export function Overlay() {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [tick, force] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  // `text` is the sentence-snapped claim text; `raw` is the user's literal
  // selection — kept because it disambiguates WHICH claim of a multi-claim
  // sentence they meant.
  const [sel, setSel] = useState<{ text: string; raw: string; rect: DOMRect; pos: SelPos | null } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot the selection at mousedown so a selection-clear between mousedown
  // and click on the pill can't drop it.
  const pending = useRef<{ text: string; raw: string; pos: SelPos | null } | null>(null);

  useEffect(() => {
    const offs = [
      on("hover", ({ sentenceId }) => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        setHoverId(sentenceId);
      }),
      on("hoverEnd", () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setHoverId(null), 120);
      }),
      on("open", ({ sentenceId }) => {
        setHoverId(null);
        setPanelId(sentenceId);
      }),
      on("create", ({ sentenceId }) => {
        setHoverId(null);
        setPanelId(sentenceId);
      }),
    ];
    const ready = () => force((n) => n + 1);
    document.addEventListener("verity:ready", ready);
    const toastHandler = (e: Event) => {
      setToast((e as CustomEvent).detail?.msg ?? null);
      setTimeout(() => setToast(null), 2600);
    };
    document.addEventListener("verity:toast", toastHandler);
    return () => {
      offs.forEach((o) => o());
      document.removeEventListener("verity:ready", ready);
      document.removeEventListener("verity:toast", toastHandler);
    };
  }, []);

  // Track text selections. With NO panel open we show a floating "+ Create
  // claim" button. With a panel open, finalizing a selection jumps the panel
  // straight into the create view seeded with that text (as if you'd clicked
  // the floating button).
  useEffect(() => {
    const qualify = (): { text: string; raw: string; rect: DOMRect; pos: SelPos | null } | null => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.rangeCount === 0) return null;
      const raw = s.toString().replace(/\s+/g, " ").trim();
      const anchor = s.anchorNode;
      // Ignore selections inside our own overlay (e.g. the validator textarea).
      const host = document.getElementById("verity-root");
      if (raw.length < 8 || !anchor || (host && host.contains(anchor))) return null;
      // Snap the selection out to whole sentences for the claim text + position.
      const exp = expandToSentenceRange(s);
      const text = exp?.text ?? raw;
      const pos = exp
        ? { el: exp.el, start: exp.start, end: exp.end, rawStart: exp.rawStart, rawEnd: exp.rawEnd }
        : null;
      let rect = s.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        const el = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
        if (el) rect = el.getBoundingClientRect();
      }
      return { text, raw, rect, pos };
    };
    const onChange = () => setSel(qualify());
    const onFinalize = (e: Event) => {
      // Ignore interactions inside our own UI (e.g. clicking Connect / buttons
      // in the side panel) — otherwise a leftover page selection would spawn a
      // new create panel on every click.
      const host = document.getElementById("verity-root");
      if (host && e.target && host.contains(e.target as Node)) return;
      const q = qualify();
      if (!q) return;
      setSel(q); // show the Support/Challenge pill next to the selection
    };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("mouseup", onFinalize);
    document.addEventListener("keyup", onFinalize);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("mouseup", onFinalize);
      document.removeEventListener("keyup", onFinalize);
    };
  }, [panelId]);

  /**
   * The user picked Support/Challenge on a selection. If the selection touches
   * a claim-bearing sentence (even partially), route to that claim's group —
   * stake view when it's on-chain, create view seeded with the canonical text
   * otherwise. A sentence can express several claims; the user's RAW selection
   * (which clause they highlighted) picks the right one. Pure-fluff selections
   * open the create view with a notice.
   */
  async function onPickSide(side: StakeSide, text: string, raw: string, pos: SelPos | null) {
    if (!text) return;
    pending.current = null;
    setSel(null);

    // Route through a synthetic record carrying the CHOSEN group's identity
    // (a shared sentence record can only point at one of its claims).
    const routeGroup = (group: ClaimGroup, base: SentenceRecord) => {
      const id = `sel-${Date.now()}`;
      records.set(id, {
        sentenceId: id,
        text: base.text,
        status: group.status,
        claim: group.claim,
        matchScore: group.matchScore,
        groupId: group.groupId,
        canonicalText: group.canonicalText,
        el: base.el,
        start: base.start,
        end: base.end,
      });
      createIntents.set(id, side);
      setPanelId(id);
    };

    // A chooser record: the selection touched several claims, so the panel
    // displays them all and the user picks (best selection-affinity first).
    const routeChooser = (candidates: ClaimGroup[], base: SentenceRecord) => {
      const id = `sel-${Date.now()}`;
      records.set(id, {
        sentenceId: id,
        text,
        status: "eligible",
        choices: candidates.map((g) => g.groupId),
        el: base.el,
        start: base.start,
        end: base.end,
      });
      createIntents.set(id, side);
      setPanelId(id);
    };

    /** Every claim group touched by the selection (across all its sentences). */
    const resolveCandidates = (): { candidates: ClaimGroup[]; base: SentenceRecord } | null => {
      if (!pos) return null;
      // Sentences the selection overlaps (partially counts).
      const overlapped: SentenceRecord[] = [];
      let base: SentenceRecord | null = null;
      let bestOverlap = 0;
      for (const [id, r] of records) {
        if (id.startsWith("sel-") || !r.groupId || r.el !== pos.el) continue;
        const overlap = Math.min(r.end, pos.end) - Math.max(r.start, pos.start);
        if (overlap <= 0) continue;
        overlapped.push(r);
        if (overlap > bestOverlap) {
          base = r;
          bestOverlap = overlap;
        }
      }
      if (!base) return null;
      const ids = new Set(overlapped.map((r) => r.sentenceId));
      let candidates = [...groups.values()].filter((g) => g.sentenceIds.some((sid) => ids.has(sid)));

      // Snap to the CLAIM, not the sentence: locate each candidate's fragment
      // within the base sentence and keep only those the literal selection
      // touches. One survivor routes directly (no chooser). If fragments can't
      // be located, or the selection spans several, keep everything and choose.
      if (candidates.length > 1) {
        const rawSentence = (base.el.textContent ?? "").slice(base.start, base.end);
        const touched = candidates.filter((g) => {
          const siblings = candidates
            .filter((o) => o.groupId !== g.groupId)
            .map((o) => o.canonicalText);
          const span = claimFragmentSpan(rawSentence, g.canonicalText, siblings);
          if (!span) return true; // unlocatable — keep as a candidate
          const fragStart = base!.start + span[0];
          const fragEnd = base!.start + span[1];
          return Math.min(fragEnd, pos.rawEnd) - Math.max(fragStart, pos.rawStart) > 0;
        });
        if (touched.length > 0) candidates = touched;
      }

      candidates.sort((a, b) => selectionAffinity(raw, b.canonicalText) - selectionAffinity(raw, a.canonicalText));
      return candidates.length > 0 ? { candidates, base } : null;
    };

    let resolved = resolveCandidates();
    if (resolved) {
      return resolved.candidates.length === 1
        ? routeGroup(resolved.candidates[0], resolved.base)
        : routeChooser(resolved.candidates, resolved.base);
    }

    // Nothing analyzed here yet? Ask the lazy loader for just this paragraph,
    // then retry the claim lookup (the "aerosols" case: selection ahead of the
    // viewport loop or in a failed batch).
    if (pos && !rangeWasAnalyzed(pos) && hooks.analyzeParagraph) {
      toastMsg("Analyzing this paragraph…");
      try {
        await hooks.analyzeParagraph(pos.el);
      } catch {
        /* fall through to the plain create flow */
      }
      resolved = resolveCandidates();
      if (resolved) {
        return resolved.candidates.length === 1
          ? routeGroup(resolved.candidates[0], resolved.base)
          : routeChooser(resolved.candidates, resolved.base);
      }
    }

    // Still no claim. Show the "no checkable claim" notice ONLY when this text
    // was actually analyzed and judged fluff — text the analyzer never saw
    // (lists/tables, analysis failures) gets the plain create flow and the
    // validator judges it.
    const analyzed = pos ? rangeWasAnalyzed(pos) : false;
    const id = `sel-${Date.now()}`;
    records.set(id, {
      sentenceId: id,
      text,
      status: "eligible",
      fluffNotice: analyzed,
      // Keep the DOM position so the new claim can be underlined in place.
      el: pos?.el ?? document.body,
      start: pos?.start ?? 0,
      end: pos?.end ?? 0,
    });
    createIntents.set(id, side);
    setPanelId(id);
  }

  const stats = useMemo(() => {
    const groupIds = new Set<string>();
    for (const [id, r] of records) {
      if (r.status === "mapped" || r.status === "low-liquidity" || r.status === "diverged") {
        groupIds.add(r.groupId ?? id);
      }
    }
    return { mapped: groupIds.size };
    // recompute when the page resolves (tick) or UI state changes
  }, [panelId, hoverId, toast, tick]);

  const hoverRec = hoverId ? records.get(hoverId) : null;
  const hoverRect = hoverId ? markRect(hoverId) : null;

  return (
    <>
      {!panelId && (
        <Launcher
          count={stats.mapped}
          loading={pageStatus.loading}
          onClick={() => {
            // Open the page list. It resolves its claims from the store on every
            // render rather than snapshotting them here, so paragraphs analyzed
            // later (lazy scroll batches) appear without reopening the panel.
            const id = `sel-${Date.now()}`;
            records.set(id, {
              sentenceId: id,
              text: "",
              status: "eligible",
              listAll: true,
              el: document.body,
              start: 0,
              end: 0,
            });
            setPanelId(id);
          }}
        />
      )}

      {hoverRec && hoverRect && (
        <HoverCard rec={hoverRec} rect={hoverRect} panelOpen={!!panelId} />
      )}

      {sel && (
        <div
          onMouseDown={(e) => {
            e.preventDefault(); /* keep the selection alive */
            pending.current = { text: sel.text, raw: sel.raw, pos: sel.pos };
          }}
          style={{
            position: "fixed",
            top: Math.max(8, sel.rect.top - 44),
            left: Math.min(sel.rect.left, window.innerWidth - 230),
            display: "flex",
            alignItems: "stretch",
            borderRadius: 999,
            overflow: "hidden",
            boxShadow: tokens.shadow,
            zIndex: tokens.z,
            font: `700 13px ${tokens.font}`,
          }}
        >
          <button
            onClick={() => {
              const p = pending.current ?? { text: sel.text, raw: sel.raw, pos: sel.pos };
              onPickSide("support", p.text, p.raw, p.pos);
            }}
            style={pillHalf(tokens.support, "left")}
          >
            ▲ Support
          </button>
          <button
            onClick={() => {
              const p = pending.current ?? { text: sel.text, raw: sel.raw, pos: sel.pos };
              onPickSide("challenge", p.text, p.raw, p.pos);
            }}
            style={pillHalf(tokens.challenge, "right")}
          >
            ▼ Challenge
          </button>
        </div>
      )}

      {panelId && (
        <SidePanel key={panelId} sentenceId={panelId} onClose={() => setPanelId(null)} />
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 76,
            right: panelId ? 396 : 20,
            background: tokens.ink,
            color: "#fff",
            fontSize: 13,
            padding: "8px 14px",
            borderRadius: 8,
            boxShadow: tokens.shadow,
            zIndex: tokens.z,
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}

function toastMsg(msg: string) {
  document.dispatchEvent(new CustomEvent("verity:toast", { detail: { msg } }));
}

/**
 * How well a canonical claim matches what the user literally highlighted:
 * the fraction of the claim's tokens present in the selection. Selecting the
 * methane clause of "While methane lasts 12 years, CO2 lasts longer" scores
 * the methane claim above the CO2 one.
 */
function selectionAffinity(selection: string, canonical: string): number {
  const selTokens = new Set(tokenize(selection));
  const canonTokens = tokenize(canonical);
  if (selTokens.size === 0 || canonTokens.length === 0) return 0;
  let hits = 0;
  for (const t of canonTokens) if (selTokens.has(t)) hits++;
  return hits / canonTokens.length;
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

/**
 * True if the selected range overlaps any analyzed sentence (claim or fluff).
 * False means the decomposition never saw this text — e.g. past the extraction
 * cap on very long articles, or in lists/tables the extractor skips.
 */
function rangeWasAnalyzed(pos: { el: HTMLElement; start: number; end: number }): boolean {
  for (const [id, r] of records) {
    if (id.startsWith("sel-") || r.el !== pos.el) continue; // ad-hoc selections don't count
    if (Math.min(r.end, pos.end) - Math.max(r.start, pos.start) > 0) return true;
  }
  return false;
}

/** One half of the split selection pill (green Support / red Challenge). */
function pillHalf(bg: string, side: "left" | "right"): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "8px 14px",
    border: "none",
    background: bg,
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    borderRight: side === "left" ? "1px solid rgba(255,255,255,0.35)" : "none",
  };
}
