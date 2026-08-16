import { tokens } from "../../shared/tokens";
import { fmtVsp } from "../../shared/format";
import type { SentenceRecord } from "../store";

const CARD_WIDTH = 360;
const PANEL_WIDTH = 380;

/**
 * Net staked position (support − challenge) as a signed VSP pill. Preferred
 * over the Verity Score here: one-sided claims saturate the score to ±100,
 * which reads as "always +100/−100" and hides how much is actually staked.
 */
function NetChip({ support, challenge, active }: { support: number; challenge: number; active: boolean }) {
  const net = support - challenge;
  const color = !active ? tokens.faint : net > 0 ? tokens.support : net < 0 ? tokens.challenge : tokens.muted;
  const sign = net > 0 ? "+" : "";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "3px 10px", borderRadius: 999, background: tokens.surfaceAlt,
        fontSize: 13, fontWeight: 700, color,
      }}
    >
      {sign}{fmtVsp(net)} VSP
    </span>
  );
}

/** Lightweight popover shown when hovering a claim mark. */
export function HoverCard({ rec, rect, panelOpen = false }: { rec: SentenceRecord; rect: DOMRect; panelOpen?: boolean }) {
  const top = rect.bottom + 8;
  // Keep the card clear of the side panel when it's open.
  const rightBound = window.innerWidth - (panelOpen ? PANEL_WIDTH : 0) - 8;
  const left = Math.max(8, Math.min(rect.left, rightBound - CARD_WIDTH));
  const c = rec.claim;

  return (
    <div
      style={{
        position: "fixed",
        top,
        left,
        width: CARD_WIDTH,
        background: tokens.surface,
        border: `1px solid ${tokens.line}`,
        borderRadius: tokens.radius,
        boxShadow: tokens.shadow,
        padding: 14,
        zIndex: tokens.z,
        pointerEvents: "none",
      }}
    >
      {rec.status === "eligible" ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: tokens.brand, marginBottom: 6 }}>
            Not staked yet
          </div>
          <div style={{ fontSize: 13, color: tokens.ink, lineHeight: 1.45 }}>
            {rec.canonicalText ?? rec.text}
          </div>
          <div style={{ fontSize: 12, color: tokens.muted, marginTop: 8 }}>
            Click to create this claim and stake on it.
          </div>
        </div>
      ) : c ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <NetChip support={c.supportStake} challenge={c.challengeStake} active={c.active} />
            <span style={{ fontSize: 11, color: tokens.faint }}>
              {rec.status === "diverged" ? "wording changed" : rec.status === "low-liquidity" ? "low liquidity" : `#${c.postId}`}
            </span>
          </div>
          <div style={{ fontSize: 13, color: tokens.ink, lineHeight: 1.45, marginBottom: 8 }}>{c.text}</div>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: tokens.muted }}>
            <span style={{ color: tokens.support }}>▲ {fmtVsp(c.supportStake)} support</span>
            <span style={{ color: tokens.challenge }}>▼ {fmtVsp(c.challengeStake)} challenge</span>
          </div>
          <div style={{ fontSize: 11, color: tokens.faint, marginTop: 8 }}>Click to open · stake · view evidence</div>
        </div>
      ) : null}
    </div>
  );
}
