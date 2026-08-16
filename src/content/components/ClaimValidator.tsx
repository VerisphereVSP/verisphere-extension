import { useEffect, useState } from "react";
import { tokens } from "../../shared/tokens";
import type { Claim } from "../../shared/types";
import type { StakeSide } from "../store";
import { api } from "../../api";
import { runLocalChecks } from "../../shared/claimChecks";
import { checkAtomicity, findDuplicates, moderateClaim } from "../../api/checks";
import { useWallet } from "../../wallet/useWallet";
import { writeMode } from "../../wallet/wallet";
import { formatTxError } from "../../wallet/errors";
import { useWriteStage, writeStageLabel } from "../../wallet/progress";
import { VSChip } from "./VS";
import { BuyVspCta } from "./BuyVspCta";
import { Dots } from "./Dots";

/**
 * The create-claim validation gate. Each check runs independently and resolves
 * on its own row (green/yellow/red, with a spinner while pending):
 *   - Coherent & complete  → LOCAL (instant)
 *   - Objectively checkable → LOCAL (instant)
 *   - Single assertion      → app /api/claims/atomicity (LLM)
 *   - Allowed content       → app /api/moderate
 *   - Not a duplicate       → app /api/claims/check-*
 *
 * The aggregate verdict gates submission; duplicates redirect to staking the
 * existing claim.
 */

type RowStatus = "loading" | "ok" | "warn" | "error";
interface RowState {
  status: RowStatus;
  message?: string;
}

const okRow: RowState = { status: "ok" };
const loadingRow: RowState = { status: "loading" };

const DEFAULT_STAKE = 10; // VSP seeded into the create-and-stake amount field

export function ClaimValidator({
  initialText,
  intentSide,
  onResolved,
}: {
  initialText: string;
  /** If present, the user came from the Support/Challenge pill: create + stake. */
  intentSide?: StakeSide;
  /**
   * Resolve to an existing/created claim. `noPaint` means "don't underline the
   * source sentence" — used when adopting a merely-similar (non-duplicate)
   * claim, which shouldn't relabel the article text.
   */
  onResolved: (claim: Claim, opts?: { noPaint?: boolean }) => void;
}) {
  const { connected, address, connect, signer, mode } = useWallet();
  const writeStage = useWriteStage();
  const [text, setText] = useState(initialText);
  const [canonical, setCanonical] = useState(initialText);
  const [hasRun, setHasRun] = useState(false);

  // Create-and-stake position (only shown when arriving via the pill).
  const [side, setSide] = useState<StakeSide>(intentSide ?? "support");
  const [stakeAmount, setStakeAmount] = useState(intentSide ? String(DEFAULT_STAKE) : "0");
  const wantStake = !!intentSide;

  const [wellFormed, setWellFormed] = useState<RowState>(okRow);
  const [verifiable, setVerifiable] = useState<RowState>(okRow);
  const [atomic, setAtomic] = useState<RowState>(loadingRow);
  const [moderation, setModeration] = useState<RowState>(loadingRow);
  const [dedup, setDedup] = useState<RowState>(loadingRow);

  const [decomposition, setDecomposition] = useState<string[] | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<Claim | null>(null);
  const [similar, setSimilar] = useState<{ claim: Claim; similarity: number }[]>([]);

  const [override, setOverride] = useState(false);
  const [phase, setPhase] = useState<"idle" | "connecting" | "creating" | "staking">("idle");
  const [err, setErr] = useState<string | null>(null);

  function runValidate(t: string) {
    const local = runLocalChecks(t);
    setCanonical(local.canonicalText);
    setWellFormed(toRow(local.wellFormed));
    setVerifiable(toRow(local.verifiable));
    setAtomic(loadingRow);
    setModeration(loadingRow);
    setDedup(loadingRow);
    setDecomposition(null);
    setDuplicateOf(null);
    setSimilar([]);
    setOverride(false);
    setErr(null);
    setHasRun(true);

    const claimText = local.canonicalText;

    checkAtomicity(claimText).then((r) => {
      if (!r.ok) return setAtomic({ status: "warn", message: "Couldn’t verify (service offline)." });
      if (r.result.atomic) return setAtomic(okRow);
      setDecomposition(r.result.subClaims.length > 1 ? r.result.subClaims : null);
      setAtomic({ status: "warn", message: "Bundles multiple assertions." });
    });

    moderateClaim(claimText).then((r) => {
      if (!r.ok) return setModeration({ status: "warn", message: "Couldn’t verify (offline)." });
      if (r.allowed) return setModeration(okRow);
      setModeration({ status: "error", message: r.reason ?? "Content not allowed." });
    });

    findDuplicates(claimText).then((r) => {
      if (!r.ok) return setDedup({ status: "warn", message: "Couldn’t check duplicates (offline)." });
      setDuplicateOf(r.result.duplicateOf ?? null);
      setSimilar(r.result.similar);
      if (r.result.duplicateOf) setDedup({ status: "error", message: "This claim already exists." });
      else if (r.result.similar.length) setDedup({ status: "warn", message: `${r.result.similar.length} similar claim(s) exist.` });
      else setDedup(okRow);
    });
  }

  useEffect(() => {
    if (initialText.trim().length >= 3) runValidate(initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = [wellFormed, verifiable, atomic, moderation, dedup];
  const anyLoading = rows.some((r) => r.status === "loading");
  const anyError = rows.some((r) => r.status === "error");
  const anyWarn = rows.some((r) => r.status === "warn");
  const verdict = duplicateOf ? "duplicate" : anyError ? "revise" : anyWarn ? "review" : "ok";
  const canSubmit =
    hasRun && !anyLoading && (verdict === "ok" || (verdict === "review" && override));

  async function submit() {
    setErr(null);
    // Use the address connect() RETURNS — `address` is stale right after connect.
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
        setErr("Connect your wallet to create.");
        setPhase("idle");
        return;
      }
      // Balances are loaded now; if there's no VSP, stop and let the Buy-VSP CTA render.
      if (writeMode(st) === "needs-vsp") {
        setPhase("idle");
        return;
      }
    }
    setPhase("creating");
    try {
      const { claim } = await api.createClaim(canonical, signer, addr);
      // The app summary lags indexing, so a just-created claim often comes back
      // with empty text — stamp the canonical we just created so the panel shows
      // the claim text immediately instead of a blank line above the VS bar.
      if (!claim.text) claim.text = canonical;
      // Combined create-and-stake: if the user set a position and we have a real
      // post id, apply the stake right after creating (second confirmation).
      const amount = parseFloat(stakeAmount) || 0;
      if (wantStake && amount > 0) {
        if (claim.postId <= 0) {
          // The claim is on-chain but we couldn't resolve its id yet — do NOT
          // pretend the stake happened. Tell the user how to complete it.
          setErr(
            "Claim created, but it isn't indexed yet so your stake wasn't placed. " +
              "Select the sentence again in a moment to stake on it.",
          );
          onResolved(claim);
          return;
        }
        setPhase("staking");
        const signed = side === "challenge" ? -amount : amount;
        try {
          const staked = await api.setStake(claim.postId, signed, signer, addr);
          if (!staked.text) staked.text = canonical;
          onResolved(staked);
          return;
        } catch (e) {
          // The claim exists even if staking failed/was cancelled — surface it
          // so the user lands on the claim and can retry staking there.
          setErr(`Claim created, but staking failed: ${formatTxError(e)}`);
          onResolved(claim);
          return;
        }
      }
      onResolved(claim);
    } catch (e) {
      setErr(formatTxError(e));
      setPhase("idle");
    }
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: tokens.brand, marginBottom: 8 }}>
        Create a claim
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Type or edit a single, checkable assertion…"
        style={{
          width: "100%",
          padding: 10,
          fontSize: 13,
          lineHeight: 1.45,
          color: tokens.ink,
          border: `1px solid ${tokens.line}`,
          borderRadius: 8,
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 12px" }}>
        <span style={{ fontSize: 11, color: tokens.faint }}>One atomic, objectively checkable claim.</span>
        <button onClick={() => runValidate(text)} style={ghostBtn}>
          {hasRun ? "Re-check" : "Check"}
        </button>
      </div>

      {hasRun && (
        <>
          <div style={{ border: `1px solid ${tokens.line}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <Row label="Coherent & complete" row={wellFormed} />
            <Row label="Objectively checkable" row={verifiable} />
            <Row label="Single assertion" row={atomic} />
            <Row label="Allowed content" row={moderation} />
            <Row label="Not a duplicate" row={dedup} />
          </div>

          <VerdictSection
            verdict={verdict}
            duplicateOf={duplicateOf}
            decomposition={decomposition}
            similar={similar}
            override={override}
            setOverride={setOverride}
            onUse={(t) => { setText(t); runValidate(t); }}
            onStakeExisting={onResolved}
            onUseSimilar={(c) => onResolved(c, { noPaint: true })}
          />

          {wantStake && verdict !== "duplicate" && (
            <StakePosition
              side={side}
              setSide={setSide}
              amount={stakeAmount}
              setAmount={setStakeAmount}
            />
          )}

          {err && <div style={{ marginTop: 8, fontSize: 12, color: tokens.challenge }}>{err}</div>}

          {(() => {
            const walletLoading = connected && mode === "loading";
            const busy =
              phase === "connecting" || phase === "creating" || phase === "staking" || walletLoading;
            // Only reveal the Buy-VSP CTA once balances are known — never during
            // the connect/loading window (avoids the flash).
            const showBuyVsp = verdict !== "duplicate" && connected && mode === "needs-vsp";
            if (showBuyVsp) {
              return (
                <div style={{ marginTop: 12 }}>
                  <BuyVspCta action="create a claim" />
                </div>
              );
            }
            if (verdict === "duplicate") return null;
            const enabled = canSubmit && !busy;
            const amt = parseFloat(stakeAmount) || 0;
            const idleLabel = !connected
              ? "Connect & create"
              : wantStake && amt > 0
              ? `Create & ${side === "challenge" ? "challenge" : "support"} ${amt} VSP`
              : "Create claim";
            return (
              <button
                onClick={submit}
                disabled={!enabled}
                style={{
                  width: "100%",
                  marginTop: 12,
                  padding: "9px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: enabled ? tokens.brand : tokens.line,
                  color: enabled ? "#fff" : tokens.faint,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: enabled ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 36,
                }}
              >
                {phase === "creating" || phase === "staking" ? (
                  writeStageLabel(writeStage) ?? (phase === "staking" ? "Staking…" : "Creating…")
                ) : phase === "connecting" || walletLoading ? (
                  <Dots />
                ) : anyLoading ? (
                  "Checking…"
                ) : (
                  idleLabel
                )}
              </button>
            );
          })()}
        </>
      )}
    </div>
  );
}

/** Create-and-stake position control: pick a side + amount before creating. */
function StakePosition({
  side,
  setSide,
  amount,
  setAmount,
}: {
  side: StakeSide;
  setSide: (s: StakeSide) => void;
  amount: string;
  setAmount: (a: string) => void;
}) {
  const amt = parseFloat(amount) || 0;
  const accent = side === "challenge" ? tokens.challenge : tokens.support;
  return (
    <div style={{ marginTop: 12, border: `1px solid ${tokens.line}`, borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: tokens.ink, marginBottom: 8 }}>
        Your opening position
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: `1px solid ${tokens.line}` }}>
          <button
            onClick={() => setSide("support")}
            style={sideBtn(side === "support", tokens.support)}
          >
            ▲ Support
          </button>
          <button
            onClick={() => setSide("challenge")}
            style={sideBtn(side === "challenge", tokens.challenge)}
          >
            ▼ Challenge
          </button>
        </div>
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{
            width: 72,
            marginLeft: "auto",
            padding: "6px 8px",
            textAlign: "right",
            fontSize: 14,
            fontWeight: 700,
            color: tokens.ink,
            border: `1px solid ${tokens.line}`,
            borderRadius: 8,
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: accent }}>VSP</span>
      </div>
      <div style={{ fontSize: 11, color: tokens.faint, marginTop: 6 }}>
        {amt > 0
          ? `You'll create the claim, then ${side === "challenge" ? "challenge" : "support"} it with ${amt} VSP (two confirmations).`
          : "Set an amount to stake as you create, or leave 0 to just create."}
      </div>
    </div>
  );
}

function sideBtn(active: boolean, color: string): React.CSSProperties {
  return {
    padding: "6px 12px",
    border: "none",
    background: active ? color : tokens.surface,
    color: active ? "#fff" : tokens.muted,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function Row({ label, row }: { label: string; row: RowState }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 0" }}>
      <StatusIcon status={row.status} />
      <div style={{ fontSize: 12.5 }}>
        <span style={{ color: tokens.ink }}>{label}</span>
        {row.message && <span style={{ color: tokens.muted }}> — {row.message}</span>}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "loading") {
    return (
      <span
        style={{
          width: 14,
          height: 14,
          marginTop: 2,
          flexShrink: 0,
          borderRadius: "50%",
          border: `2px solid ${tokens.line}`,
          borderTopColor: tokens.brand,
          display: "inline-block",
          animation: "vr-spin 0.7s linear infinite",
        }}
      />
    );
  }
  const map = {
    ok: { c: tokens.support, t: "✓" },
    warn: { c: "#d97706", t: "!" },
    error: { c: tokens.challenge, t: "✕" },
  } as const;
  const { c, t } = map[status];
  return (
    <span style={{ width: 16, height: 16, marginTop: 1, flexShrink: 0, borderRadius: "50%", background: c, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {t}
    </span>
  );
}

function VerdictSection({
  verdict,
  duplicateOf,
  decomposition,
  similar,
  override,
  setOverride,
  onUse,
  onStakeExisting,
  onUseSimilar,
}: {
  verdict: string;
  duplicateOf: Claim | null;
  decomposition: string[] | null;
  similar: { claim: Claim; similarity: number }[];
  override: boolean;
  setOverride: (b: boolean) => void;
  onUse: (t: string) => void;
  onStakeExisting: (c: Claim) => void;
  onUseSimilar: (c: Claim) => void;
}) {
  if (verdict === "duplicate" && duplicateOf) {
    return (
      <div style={banner("#eef2ff", "#c7d2fe")}>
        <div style={{ fontSize: 12, fontWeight: 700, color: tokens.brandInk, marginBottom: 6 }}>
          This claim already exists
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: tokens.ink }}>{duplicateOf.text}</span>
          <VSChip evs={duplicateOf.evs} active={duplicateOf.active} />
        </div>
        <button onClick={() => onStakeExisting(duplicateOf)} style={primaryFull}>
          Stake on the existing claim instead
        </button>
      </div>
    );
  }

  if (verdict === "revise") {
    return (
      <div style={banner("#fef2f2", "#fecaca")}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b" }}>Needs revision</div>
        <div style={{ fontSize: 12, color: "#991b1b", marginTop: 4 }}>
          Fix the flagged issue above, then re-check.
        </div>
      </div>
    );
  }

  if (verdict === "review") {
    return (
      <div style={banner("#fffbeb", "#fde68a")}>
        {decomposition && decomposition.length > 1 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
              Split into atomic claims?
            </div>
            {decomposition.map((p) => (
              <button key={p} onClick={() => onUse(p)} style={chipBtn}>{p}</button>
            ))}
          </div>
        )}
        {similar.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
              Similar existing claims
            </div>
            {similar.map((s) => (
              <div key={s.claim.postId} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
                <span style={{ fontSize: 12.5, color: tokens.ink }}>{s.claim.text}</span>
                <button onClick={() => onUseSimilar(s.claim)} style={ghostBtn}>Use</button>
              </div>
            ))}
          </div>
        )}
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#92400e", cursor: "pointer" }}>
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Create anyway — I understand the above.
        </label>
      </div>
    );
  }

  return (
    <div style={banner("#ecfdf5", "#a7f3d0")}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#065f46" }}>Looks good — ready to create.</div>
    </div>
  );
}

function toRow(c: { severity: "ok" | "warn" | "error"; message?: string }): RowState {
  return { status: c.severity, message: c.message };
}

function banner(bg: string, border: string): React.CSSProperties {
  return { background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 10 };
}
const ghostBtn: React.CSSProperties = {
  padding: "3px 10px", borderRadius: 6, border: `1px solid ${tokens.line}`,
  background: tokens.surface, fontSize: 12, fontWeight: 600, color: tokens.brand, cursor: "pointer",
};
const chipBtn: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", margin: "0 0 4px",
  padding: "6px 8px", borderRadius: 6, border: `1px solid ${tokens.line}`,
  background: tokens.surface, fontSize: 12.5, color: tokens.ink, cursor: "pointer",
};
const primaryFull: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 8, border: "none",
  background: tokens.brand, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
};
