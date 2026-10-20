import { tokens } from "../../shared/tokens";
import { TradeVsp } from "./TradeVsp";

/** Shown when a connected wallet has no VSP: buy some right here (TradeVsp, buy side). */
export function BuyVspCta({ action }: { action: string }) {
  return (
    <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tokens.brandInk, marginBottom: 4 }}>You need VSP to {action}</div>
      <TradeVsp side="buy" />
    </div>
  );
}
