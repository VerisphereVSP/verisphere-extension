// src/shared/checkText.ts — patch_ext_check: pure helpers for "Check on Verisphere" (no DOM, no chrome; node-testable)
export const CHECK_MIN_CHARS = 8;
export const CHECK_MAX_CHARS = 600;

/** Whitespace-folded, trimmed, bounded; null when there is nothing checkable. */
export function normalizeCheckText(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (t.length < CHECK_MIN_CHARS) return null;
  return t.length > CHECK_MAX_CHARS ? t.slice(0, CHECK_MAX_CHARS).replace(/\s+\S*$/, "") + "…" : t;
}

/** Title and headings as candidate phrases for the app's lookup: cleaned, deduplicated, bounded. */
export function phrasesFrom(title: string | null | undefined, headings: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    if (t.length >= 3 && t.length <= 120 && !out.includes(t)) out.push(t);
  };
  push(title);
  for (const h of headings.slice(0, 12)) push(h);
  return out.slice(0, 16);
}

/** The app's Start sheet for this claim and side — where a reader without MetaMask on this page goes to stake. */
export function handoffUrl(appUrl: string, postId: number, side?: "support" | "challenge" | null): string {
  return `${appUrl.replace(/\/$/, "")}/claims?post=${postId}${side ? `&side=${side}` : ""}&start=1`;
}

/** Pages where injection is impossible or pointless (the browser forbids chrome://, the store, and our own pages). */
export function injectable(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !/(^|\.)chromewebstore\.google\.com$/.test(u.hostname) && !/^chrome\./.test(u.hostname);
  } catch {
    return false;
  }
}

/** The link and text with an invitation attached — the same shape the app produces (invitation line above the link). */
export function withInvitation(shareUrl: string, shareText: string, code: string, amountVsp: string): { url: string; text: string } {
  const url = `${shareUrl}${shareUrl.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`;
  const line = `I've set aside ${amountVsp} VSP for you to try Verisphere — the link carries it.`;
  const parts = shareText.split("\n");
  const text = parts.length > 1 && parts[parts.length - 1].trim() === shareUrl
    ? [...parts.slice(0, -1), line, url].join("\n")
    : `${shareText.replace(shareUrl, url)} ${line}`;
  return { url, text };
}
