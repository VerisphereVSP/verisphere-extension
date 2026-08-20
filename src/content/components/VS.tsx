import { evsToColor, evsLabel } from "../../shared/vsColor";
import { tokens } from "../../shared/tokens";

/**
 * A compact Verity Score chip. Filled with the same solid score color as the
 * in-page superscript badge, so a claim looks the same in the text and in the
 * panel.
 */
export function VSChip({ evs, active = true }: { evs?: number; active?: boolean }) {
  const scored = active && evs !== undefined && !Number.isNaN(evs);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${scored ? "transparent" : tokens.line}`,
        background: scored ? evsToColor(evs) : "#f3f4f6",
        fontSize: 12,
        fontWeight: 600,
        color: scored ? "#fff" : tokens.muted,
        whiteSpace: "nowrap",
      }}
    >
      {evsLabel(evs, active)}
    </span>
  );
}

/** The horizontal Verity Score bar (−100 … +100), ported from the web app. */
export function VSBar({ evs }: { evs?: number }) {
  const rated = evs !== undefined && !Number.isNaN(evs);
  const value = rated ? (evs as number) : 0;
  const pct = ((value + 100) / 200) * 100;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: tokens.muted, marginBottom: 4 }}>
        <span>challenged</span>
        {!rated && <span style={{ fontWeight: 700, color: tokens.faint }}>unrated</span>}
        <span>supported</span>
      </div>
      <div style={{ height: 8, background: "linear-gradient(90deg,#dc2626,#ffffff,#16a34a)", borderRadius: 999, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: -2,
            left: `calc(${pct}% - 6px)`,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#fff",
            border: `2px solid ${tokens.ink}`,
          }}
        />
      </div>
    </div>
  );
}
