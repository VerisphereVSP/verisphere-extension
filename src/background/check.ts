// src/background/check.ts — patch_ext_check (extension 0.1.4)
// "Check on Verisphere" from the context menu or the toolbar popup: inject the overlay into the active tab — on that
// user gesture only, under activeTab, so no site is read without the reader asking — then hand it the text.
// The two scripts are the same ones the manifest declares for Wikipedia; crxjs's ?script / ?iife imports give their
// built file names.
import contentScript from "../content/dynamic.tsx?script";
import inpageScript from "../inpage/dynamic.ts?iife";

export const MENU_ID = "verisphere-check";
export const MENU_TITLE = "Check on Verisphere";  // the one gesture the first-run page teaches; keep it

import { injectable } from "../shared/checkText";
export { injectable };

/** True once the content script answers — present in the tab and listening. */
async function listening(tabId: number): Promise<boolean> {
  try {
    const r = (await chrome.tabs.sendMessage(tabId, { type: "verisphere:ping" })) as { mounted?: boolean } | undefined;
    return typeof r?.mounted === "boolean";
  } catch {
    return false; // no content script in this tab yet
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Make sure the overlay's two scripts are in the tab (idempotent), then ask it to check the text. */
export async function checkInTab(tabId: number, text: string | null): Promise<void> {
  if (!(await listening(tabId))) {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: [inpageScript] });
    await chrome.scripting.executeScript({ target: { tabId }, files: [contentScript] });
    // the content script is a loader that imports its module: wait until it answers before talking to it
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { await sleep(100); ok = await listening(tabId); }
    if (!ok) throw new Error("the page did not accept the overlay");
  }
  await chrome.tabs.sendMessage(tabId, { type: "verisphere:check", text });
}

export function installCheckMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: MENU_TITLE, contexts: ["selection"] });
  });
}

export function wireCheck(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab?.id || !injectable(tab.url)) return;
    void checkInTab(tab.id, info.selectionText ?? null).catch((e) => console.warn("[Verisphere] check failed:", e));
  });
  // the popup's "Check the selected text" button: the active tab's own selection
  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (msg?.type !== "vr-check-active") return;
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !injectable(tab.url)) { sendResponse({ ok: false, error: "This page cannot be checked" }); return; }
      try {
        await checkInTab(tab.id, null);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  });
}
