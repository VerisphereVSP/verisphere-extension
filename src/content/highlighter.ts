import { evsToColor } from "../shared/vsColor";
import { tokens } from "../shared/tokens";
import { emit, records, type SentenceRecord } from "./store";

/**
 * Paints claim marks directly into the page (light DOM), because a highlight
 * must visually integrate with Wikipedia's text. The interactive chrome (hover
 * card, side panel) lives in a shadow root instead. Marks communicate with the
 * overlay via the verity:* event bus.
 */

const MARK_ATTR = "data-vr-sentence";

export function injectMarkStyles() {
  if (document.getElementById("vr-mark-styles")) return;
  const style = document.createElement("style");
  style.id = "vr-mark-styles";
  style.textContent = `
    .vr-mark {
      cursor: pointer;
      border-bottom: 2px solid var(--vr-color, ${tokens.brand});
    }
    .vr-mark--hover { background-color: rgba(79,70,229,0.12); border-radius: 2px; }
    .vr-mark--low { border-bottom-style: dashed; }
    .vr-mark--diverged { border-bottom-color: #d97706; border-bottom-style: dotted; }
    .vr-badge {
      font: 600 10px ${tokens.font};
      vertical-align: super;
      margin-left: 2px;
      padding: 0 4px;
      border-radius: 8px;
      color: #fff;
      background: var(--vr-color, ${tokens.brand});
      user-select: none;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Only sentences whose claim exists ON-CHAIN get painted. "Eligible" groups
 * (decomposed claims nobody has created yet) stay unmarked — underlining most
 * of the article was noise; selecting text still routes to its claim group.
 */
function paintable(rec: SentenceRecord): boolean {
  return rec.status === "mapped" || rec.status === "low-liquidity" || rec.status === "diverged";
}

/** Render marks for every renderable sentence record. */
export function paint(recs: SentenceRecord[]) {
  for (const rec of recs) {
    records.set(rec.sentenceId, rec);
    if (!paintable(rec)) continue;
    try {
      wrapRange(rec);
    } catch {
      /* ranges that cross awkward DOM boundaries are skipped, not fatal */
    }
  }
  wireEvents();
}

function classFor(rec: SentenceRecord): string {
  switch (rec.status) {
    case "low-liquidity":
      return "vr-mark vr-mark--low";
    case "diverged":
      return "vr-mark vr-mark--diverged";
    default:
      return "vr-mark";
  }
}

/** Wrap the [start,end) character range within rec.el's text nodes. */
function wrapRange(rec: SentenceRecord) {
  const color = rec.claim ? evsToColor(rec.claim.evs) : tokens.brand;
  const cls = classFor(rec);
  // Underline just this claim's fragment when known (multi-claim sentences);
  // otherwise the whole sentence.
  const rangeStart = rec.claimStart ?? rec.start;
  const rangeEnd = rec.claimEnd ?? rec.end;
  let offset = 0;
  const walker = document.createTreeWalker(rec.el, NodeFilter.SHOW_TEXT);
  const toWrap: { node: Text; from: number; to: number }[] = [];

  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    const from = Math.max(rangeStart, nodeStart);
    const to = Math.min(rangeEnd, nodeEnd);
    if (from < to) {
      toWrap.push({ node, from: from - nodeStart, to: to - nodeStart });
    }
    offset = nodeEnd;
    if (nodeStart >= rangeEnd) break;
    node = walker.nextNode() as Text | null;
  }

  for (const { node, from, to } of toWrap) {
    let target = node;
    if (from > 0) target = target.splitText(from);
    if (to - from < target.data.length) target.splitText(to - from);
    const span = document.createElement("span");
    span.className = cls;
    span.setAttribute(MARK_ATTR, rec.sentenceId);
    span.style.setProperty("--vr-color", color);
    target.replaceWith(span);
    span.appendChild(target);
  }

  // Append a score badge to the final fragment of a mapped claim.
  const frags = rec.el.querySelectorAll(`[${MARK_ATTR}="${cssEscape(rec.sentenceId)}"]`);
  const last = frags[frags.length - 1] as HTMLElement | undefined;
  if (last && rec.claim && rec.status === "mapped") {
    const badge = document.createElement("span");
    badge.className = "vr-badge";
    badge.style.setProperty("--vr-color", color);
    badge.textContent = rec.claim.evs > 0 ? `+${Math.round(rec.claim.evs)}` : `${Math.round(rec.claim.evs)}`;
    last.appendChild(badge);
  }
}

/** All sentence ids that should light up together with `id` (its claim group). */
function hoverSet(id: string): string[] {
  const gid = records.get(id)?.groupId;
  if (!gid) return [id];
  const ids: string[] = [];
  for (const [sid, r] of records) if (r.groupId === gid) ids.push(sid);
  return ids.length ? ids : [id];
}

// Shade every fragment of the hovered claim together — a sentence can be split
// into multiple marks around links, and a claim group can span multiple
// sentences, so CSS :hover alone isn't enough.
let hoverEls: Element[] = [];
function setHover(id: string | null) {
  for (const el of hoverEls) el.classList.remove("vr-mark--hover");
  hoverEls = [];
  if (id) {
    for (const sid of hoverSet(id)) {
      hoverEls.push(...Array.from(document.querySelectorAll(`[${MARK_ATTR}="${cssEscape(sid)}"]`)));
    }
    for (const el of hoverEls) el.classList.add("vr-mark--hover");
  }
}

let wired = false;
function wireEvents() {
  if (wired) return;
  wired = true;
  document.addEventListener("mouseover", (e) => {
    const mark = (e.target as HTMLElement)?.closest?.(`[${MARK_ATTR}]`);
    if (!mark) return;
    const id = mark.getAttribute(MARK_ATTR)!;
    setHover(id);
    emit("hover", { sentenceId: id });
  });
  document.addEventListener("mouseout", (e) => {
    const mark = (e.target as HTMLElement)?.closest?.(`[${MARK_ATTR}]`);
    if (!mark) return;
    const id = mark.getAttribute(MARK_ATTR)!;
    // Keep the shade while moving between fragments/sentences of the same claim.
    const toMark = (e as MouseEvent).relatedTarget instanceof Element
      ? ((e as MouseEvent).relatedTarget as Element).closest(`[${MARK_ATTR}]`)
      : null;
    const toId = toMark?.getAttribute(MARK_ATTR);
    const sameGroup = toId != null && (toId === id || (records.get(toId)?.groupId != null && records.get(toId)?.groupId === records.get(id)?.groupId));
    if (!sameGroup) {
      setHover(null);
      emit("hoverEnd", {});
    }
  });
  document.addEventListener("click", (e) => {
    const mark = (e.target as HTMLElement)?.closest?.(`[${MARK_ATTR}]`);
    if (!mark) return;
    const id = mark.getAttribute(MARK_ATTR)!;
    const rec = records.get(id);
    if (!rec) return;
    e.preventDefault();
    if (rec.status === "eligible") emit("create", { sentenceId: id, text: rec.text });
    else emit("open", { sentenceId: id });
  });
}

/** Remove any painted fragments for a sentence, restoring the raw text nodes. */
function unwrapSentence(id: string) {
  const frags = document.querySelectorAll(`[${MARK_ATTR}="${cssEscape(id)}"]`);
  frags.forEach((frag) => {
    // Drop any score badge, then unwrap the span back into a text node.
    frag.querySelectorAll(".vr-badge").forEach((b) => b.remove());
    const parent = frag.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(frag.textContent ?? ""), frag);
    parent.normalize(); // merge adjacent text nodes so offsets stay contiguous
  });
}

/**
 * (Re)paint a single sentence after its record changes — e.g. a freshly created
 * claim upgrading an "eligible"/selection sentence to a live underline. Safe to
 * call whether or not the sentence was previously painted.
 */
export function repaintSentence(id: string) {
  const rec = records.get(id);
  if (!rec) return;
  unwrapSentence(id);
  if (!paintable(rec)) return; // unmark and stop (e.g. still just eligible)
  try {
    wrapRange(rec);
  } catch {
    /* awkward DOM boundaries — skip silently */
  }
}

/** Repaint every sentence of a claim group (after create/stake). */
export function repaintGroup(groupId: string) {
  for (const [id, r] of records) {
    // Skip synthetic selection records — they mirror a real sentence's range
    // and painting them too would double-mark it.
    if (id.startsWith("sel-")) continue;
    if (r.groupId === groupId) repaintSentence(id);
  }
}

/** Locate a sentence's rendered rect (for positioning overlay UI). */
export function markRect(sentenceId: string): DOMRect | null {
  const el = document.querySelector(`[${MARK_ATTR}="${cssEscape(sentenceId)}"]`);
  return el ? el.getBoundingClientRect() : null;
}

function cssEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}
