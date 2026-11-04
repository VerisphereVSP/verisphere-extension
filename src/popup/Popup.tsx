import { useEffect, useState } from "react";
import { tokens } from "../shared/tokens";
import { env } from "../shared/env";

/**
 * Toolbar popup: a global on/off switch for the overlay.
 *
 * No wallet connect here — an injected wallet (window.ethereum) only exists on
 * the page, not in this popup context, so connecting happens from the side
 * panel on the article. Toggling reloads the active tab so it takes effect.
 */
export function Popup() {
  const [enabled, setEnabled] = useState(true);
  const [checkNote, setCheckNote] = useState<string | null>(null); // patch_ext_check

  useEffect(() => {
    chrome.storage?.local.get("enabled").then((v) => {
      if (typeof v.enabled === "boolean") setEnabled(v.enabled);
    });
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    try {
      await chrome.storage.local.set({ enabled: next });
      // Apply immediately: the content script reads `enabled` on page load.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) chrome.tabs.reload(tab.id);
    } catch {
      /* the setting still persists; it applies on next page load */
    }
  }

  return (
    <div style={{ font: `14px ${tokens.font}`, color: tokens.ink }}>
      <div style={{ background: `linear-gradient(90deg, ${tokens.brandInk}, ${tokens.brand})`, color: "#fff", padding: "14px 16px" }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Verisphere</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>Spot misinformation as you read</div>
      </div>

      <div style={{ padding: 16 }}>
        {/* patch_ext_check: the toolbar route to the same check as the context menu */}
        <button
          onClick={async () => {
            setCheckNote(null);
            const r = (await chrome.runtime.sendMessage({ type: "vr-check-active" })) as { ok?: boolean; error?: string } | undefined;
            if (r?.ok) window.close();
            else setCheckNote(r?.error ?? "Select a sentence on the page first");
          }}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "none", background: tokens.brand, color: "#fff", font: `700 13px ${tokens.font}`, cursor: "pointer", marginBottom: 6 }}
        >
          Check the selected text
        </button>
        <div style={{ fontSize: 11.5, color: tokens.muted, marginBottom: 14, lineHeight: 1.4 }}>
          {checkNote ?? <>Or select text on any page and right-click → <b>Check on Verisphere</b>.</>}
        </div>
        <Row label="Wikipedia underlines">
          <button
            onClick={toggle}
            style={{ ...toggleBtn, background: enabled ? tokens.support : tokens.line, color: enabled ? "#fff" : tokens.muted }}
          >
            {enabled ? "On" : "Off"}
          </button>
        </Row>

        <Row label="Portfolio">
          <a
            href={env.portfolioUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: tokens.brand,
              textDecoration: "none",
            }}
          >
            Open →
          </a>
        </Row>

        <div style={{ marginTop: 14, fontSize: 12, color: tokens.muted, lineHeight: 1.5 }}>
          Open any Wikipedia article — claims are highlighted by their on-chain
          Verity Score. Hover to preview; click a claim or select text to stake
          or create. <b>Connect your wallet from the side panel</b> on the page.
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: tokens.faint }}>
          Toggling the overlay reloads the current tab.
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${tokens.line}` }}>
      <span style={{ color: tokens.muted, fontSize: 13 }}>{label}</span>
      {children}
    </div>
  );
}

const toggleBtn: React.CSSProperties = {
  padding: "5px 16px",
  borderRadius: 999,
  border: "none",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
