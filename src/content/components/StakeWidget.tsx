import { useEffect, useState } from "react";
import { tokens } from "../../shared/tokens";
import { fmtVsp } from "../../shared/format";
import type { Claim } from "../../shared/types";
import { api } from "../../api";
import { useWallet } from "../../wallet/useWallet";
import { writeMode } from "../../wallet/wallet";
import { formatTxError } from "../../wallet/errors";
import { useWriteStage, writeStageLabel, useFeeQuote } from "../../wallet/progress";  // patch_ext_gas_fee
import { BuyVspCta } from "./BuyVspCta";
import { Dots } from "./Dots";

/**
 * Target-based stake control mirroring frontend/src/components/StakeControl.tsx:
 * the user sets a net position (positive = support, negative = challenge) and we
 * call setStake once. Writes go through the relay (wallet only signs).
 */
export function StakeWidget({
  claim,
  initialSide,
  onUpdated,
}: {
  claim: Claim;
  /** Seeds the position sign when the user arrived via the Support/Challenge pill. */
  initialSide?: "support" | "challenge";
  onUpdated: (c: Claim) => void;
}) {
  const { connected, address, balance, connect, signer, mode } = useWallet();
  const writeStage = useWriteStage();
  const feeQuote = useFeeQuote();  // patch_ext_gas_fee: the relay fee for this action, shown while signing
  const [target, setTarget] = useState(initialSide === "challenge" ? "-10" : initialSide === "support" ? "10" : "0");
  const [phase, setPhase] = useState<"idle" | "connecting" | "submitting">("idle");
  const [err, setErr] = useState<string | null>(null);
  // The user's current net position (support − challenge) on this claim; the
  // wallet only moves the difference between it and the target.
  const [position, setPosition] = useState(0);

  useEffect(() => {
    if (!connected || !address) return;
    api.getUserStake(claim.postId, address).then((s) => {
      const net = s.userSupport - s.userChallenge;
      setPosition(net);
      // An existing position wins over the pill-seeded default.
      if (net !== 0) setTarget(net.toFixed(2));
    });
  }, [connected, address, claim.postId]);

  const targetVal = parseFloat(target) || 0;
  const side = targetVal > 0 ? "support" : targetVal < 0 ? "challenge" : "none";
  const sideColor = targetVal > 0 ? tokens.support : targetVal < 0 ? tokens.challenge : tokens.muted;
  const walletLoading = connected && mode === "loading";
  const busy = phase !== "idle" || walletLoading;
  // VSP this change moves: into escrow when positive, back to the wallet when negative.
  const have = balance ?? 0;
  const escrowDelta = Math.abs(targetVal) - Math.abs(position);
  const after = have - escrowDelta;
  const insufficient = connected && !walletLoading && after < -1e-9;

  async function apply() {
    if (phase !== "idle") return;
    setErr(null);
    // Use the address connect() RETURNS — the `address` closure var is stale
    // right after connecting (state updates don't update locals).
    let addr = address;
    if (!addr) {
      setPhase("connecting");
      let st;
      try {
        st = await connect();
      } catch (e) {
        setErr(formatTxError(e));
        setPhase("idle");
        return;
      }
      addr = st.address;
      if (!addr) {
        setErr("Connect your wallet to stake.");
        setPhase("idle");
        return;
      }
      // Balances loaded; if there's no VSP, stop — the Buy-VSP CTA now renders.
      if (writeMode(st) === "needs-vsp") {
        setPhase("idle");
        return;
      }
    }
    setPhase("submitting");
    try {
      const updated = await api.setStake(claim.postId, targetVal, signer, addr);
      onUpdated(updated);
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setPhase("idle");
    }
  }

  if (connected && mode === "needs-vsp") {
    return (
      <div style={{ border: `1px solid ${tokens.line}`, borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: tokens.ink, marginBottom: 8 }}>Your position</div>
        <BuyVspCta action="stake" />
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${tokens.line}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: tokens.ink, marginBottom: 8 }}>Your position</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => setTarget((targetVal - 1).toFixed(2))} style={stepBtn}>−</button>
        <input
          type="number"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          style={{
            width: 90,
            padding: "6px 8px",
            textAlign: "right",
            fontSize: 14,
            fontWeight: 700,
            color: tokens.ink,
            border: `1px solid ${tokens.line}`,
            borderRadius: 8,
          }}
        />
        <button onClick={() => setTarget((targetVal + 1).toFixed(2))} style={stepBtn}>+</button>
        <span style={{ fontSize: 12, fontWeight: 700, color: sideColor, minWidth: 74 }}>VSP · {side}</span>
        <button onClick={apply} disabled={busy || insufficient} style={{ ...applyBtn, opacity: busy || insufficient ? 0.6 : 1 }}>
          {phase === "submitting" ? (
            (writeStageLabel(writeStage) ?? "…") + (feeQuote != null && writeStage === "awaiting-wallet" ? ` fee ${feeQuote.toFixed(3)} VSP` : "")
          ) : phase === "connecting" || walletLoading ? (
            <Dots />
          ) : connected ? (
            "Apply"
          ) : (
            "Connect & stake"
          )}
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: tokens.faint, marginTop: 8 }}>
        <span>Positive supports · negative challenges · 0 withdraws</span>
        {connected && <span>Balance: {fmtVsp(balance)} VSP</span>}
      </div>
      {connected && !walletLoading && escrowDelta !== 0 && (
        <div style={{ fontSize: 11, marginTop: 4, color: insufficient ? tokens.challenge : tokens.muted }}>
          {insufficient
            ? `Not enough VSP: this position needs ${fmtVsp(escrowDelta)} more, you have ${fmtVsp(have)}.`
            : escrowDelta > 0
              ? `Moves ${fmtVsp(escrowDelta)} VSP into escrow · ${fmtVsp(after)} VSP left in your wallet${mode === "relay" ? " (before the relay fee)" : ""}`
              : `Returns ${fmtVsp(-escrowDelta)} VSP to your wallet · ${fmtVsp(after)} VSP after`}
        </div>
      )}
      {err && (
        <div style={{ marginTop: 8, fontSize: 12, color: tokens.challenge, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "6px 8px" }}>
          {err}
        </div>
      )}
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: `1px solid ${tokens.line}`,
  background: tokens.surface,
  cursor: "pointer",
  fontSize: 16,
  color: tokens.ink,
};

const applyBtn: React.CSSProperties = {
  marginLeft: "auto",
  padding: "6px 14px",
  borderRadius: 8,
  border: "none",
  background: tokens.brand,
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
