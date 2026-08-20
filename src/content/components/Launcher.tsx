import { tokens } from "../../shared/tokens";
import { Dots } from "./Dots";

/**
 * Floating brand launcher, bottom-right. Shows the page's claim count, plus a
 * small pulsing-dots indicator while paragraphs are being analyzed.
 */
export function Launcher({
  count,
  loading,
  onClick,
}: {
  count: number;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 999,
        border: "none",
        background: `linear-gradient(90deg, ${tokens.brandInk}, ${tokens.brand})`,
        color: "#fff",
        fontWeight: 700,
        fontSize: 13,
        boxShadow: tokens.shadow,
        cursor: "pointer",
        zIndex: tokens.z,
        transition: "right 0.18s ease",
      }}
    >
      <img
        src={chrome.runtime.getURL("icons/icon-32.png")}
        alt=""
        style={{ width: 18, height: 18, borderRadius: 5 }}
      />
      VeriSphere
      {count > 0 && (
        <span style={{ background: "rgba(255,255,255,0.25)", borderRadius: 999, padding: "1px 8px", fontSize: 12 }}>
          {count}
        </span>
      )}
      {loading && <Dots />}
    </button>
  );
}
