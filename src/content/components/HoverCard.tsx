import { tokens } from "../../shared/tokens";
import { fmtVsp } from "../../shared/format";
import { rankedGroups, type SentenceRecord } from "../store";

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
  // The sentence's other claims (a multi-claim sentence shows its top-ranked one here).
  const others = rec.choices && rec.choices.length > 1 ? rankedGroups(rec.choices).filter((g) => g.groupId !== rec.groupId) : [];

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
          {others.length > 0 ? (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${tokens.line}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: tokens.brand, marginBottom: 4 }}>
                This sentence states {others.length + 1} claims
              </div>
              {others.map((g) => (
                <div key={g.groupId} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: tokens.muted, lineHeight: 1.4, marginBottom: 2 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.canonicalText}</span>
                  <span style={{ whiteSpace: "nowrap", color: tokens.faint }}>
                    {g.claim ? `${g.claim.supportStake - g.claim.challengeStake > 0 ? "+" : ""}${fmtVsp(g.claim.supportStake - g.claim.challengeStake)} VSP` : "not staked yet"}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: tokens.faint, marginTop: 6 }}>Click to choose which one to stake on</div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: tokens.faint, marginTop: 8 }}>Click to open · stake · view evidence</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
