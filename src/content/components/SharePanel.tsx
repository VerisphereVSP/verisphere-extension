// src/content/components/SharePanel.tsx — patch_ext_share (extension 0.1.4)
// Share a claim from the panel: the app's Snapshot text (standing, quote, question, link) and link, and — with a wallet
// connected — an invitation that escrows VSP behind the link. Same endpoints and the same text the app's Share menu
// uses; the extension holds no state of its own here.
import { useEffect, useState } from "react";
import { bgFetch } from "../../api/bgFetch";
import { env } from "../../shared/env";
import { tokens } from "../../shared/tokens";
import { useWallet } from "../../wallet/useWallet";
import { issueInvitation } from "../../wallet/relay";

interface Snapshot { post_id: number; share_url: string; share_text: string; standing?: string; band: string }
interface Issued { code: string; amount_vsp: string; expires_at: string }

const appBase = env.appApiBase;

import { withInvitation } from "../../shared/checkText";
export { withInvitation };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SharePanel({ postId, onClose }: { postId: number; onClose: () => void }) {
  const { connected, address } = useWallet();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [amount, setAmount] = useState("2");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);

  useEffect(() => {
    bgFetch<Snapshot>(`${appBase}/claims/${postId}/snapshot`).then((r) => {
      if (r.ok && r.json) setSnap(r.json);
      else setErr(r.error ?? `snapshot ${r.status}`);
    });
  }, [postId]);

  const eff = snap ? (issued ? withInvitation(snap.share_url, snap.share_text, issued.code, issued.amount_vsp) : { url: snap.share_url, text: snap.share_text }) : null;
  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(null), 2400); };

  async function issue() {
    if (!address || !snap) return;
    setBusy(true); setErr(null);
    try {
      const inv = await issueInvitation({ amountVsp: amount, expiresDays: Number(days) || 30, postId });
      setIssued(inv);
      setInviteOpen(false);
      const e2 = withInvitation(snap.share_url, snap.share_text, inv.code, inv.amount_vsp);
      flash((await copyText(e2.text)) ? "Invitation attached and snapshot copied — paste it to your friend" : "Invitation attached — click Copy snapshot");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the invitation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-vr="share" style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 13, color: tokens.ink }}>Share this claim</span>
        <button onClick={onClose} style={xBtn} aria-label="Close share">×</button>
      </div>
      {!snap && !err && <div style={{ fontSize: 12, color: tokens.muted }}>Preparing the snapshot…</div>}
      {err && <div style={{ fontSize: 12, color: tokens.challenge, marginBottom: 8 }}>{err}</div>}
      {snap && eff && (
        <>
          <pre style={textBox}>{eff.text}</pre>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button data-vr="share-copy" onClick={async () => flash((await copyText(eff.text)) ? "Snapshot copied — paste it into a chat or a post" : "Could not copy")} style={btn}>Copy snapshot</button>
            <button data-vr="share-link" onClick={async () => flash((await copyText(eff.url)) ? "Link copied" : "Could not copy")} style={btn}>Copy link</button>
          </div>
          {connected && !issued && !inviteOpen && (
            <button data-vr="share-invite-open" onClick={() => setInviteOpen(true)} style={{ ...btn, width: "100%", marginTop: 8, color: tokens.brand }}
              title="Set aside some of your VSP behind this link so the reader can try Verisphere without buying first">Include an invitation</button>
          )}
          {connected && inviteOpen && !issued && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12, color: tokens.muted }}>
              Amount <input data-vr="share-invite-amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} /> VSP · Expires in
              <input data-vr="share-invite-days" value={days} onChange={(e) => setDays(e.target.value)} style={input} /> days
              <button data-vr="share-invite-go" onClick={issue} disabled={busy} style={{ ...btn, background: tokens.brand, color: "#fff", borderColor: tokens.brand }}>{busy ? "Signing…" : "Create invitation"}</button>
            </div>
          )}
          {issued && (
            <div data-vr="share-invited" style={{ marginTop: 8, fontSize: 12, color: tokens.ink, background: "#EDEAFB", border: "1px solid #D9D4F0", borderRadius: 8, padding: "6px 10px" }}>
              {issued.amount_vsp} VSP set aside · code <b>{issued.code}</b> · the link above carries it. Revoke any time from Positions in the app.
            </div>
          )}
          {!connected && <div style={{ marginTop: 8, fontSize: 11, color: tokens.faint }}>Connect a wallet to include an invitation (VSP you set aside so the reader can try Verisphere).</div>}
        </>
      )}
      {note && <div style={{ marginTop: 8, fontSize: 12, color: tokens.support, fontWeight: 600 }}>{note}</div>}
    </div>
  );
}

const card: React.CSSProperties = { margin: "12px 0", padding: 12, border: `1px solid ${tokens.line}`, borderRadius: 10, background: tokens.surfaceAlt };
const textBox: React.CSSProperties = { whiteSpace: "pre-wrap", wordBreak: "break-word", font: `12px/1.45 ${tokens.font}`, color: tokens.ink, background: "#fff", border: `1px solid ${tokens.line}`, borderRadius: 8, padding: "8px 10px", margin: "0 0 8px", maxHeight: 140, overflowY: "auto" };
const btn: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, border: `1px solid ${tokens.line}`, background: "#fff", color: tokens.ink, font: `600 12px ${tokens.font}`, cursor: "pointer" };
const input: React.CSSProperties = { width: 56, padding: "5px 6px", border: `1px solid ${tokens.line}`, borderRadius: 6, font: `12px ${tokens.font}`, textAlign: "right" };
const xBtn: React.CSSProperties = { border: "none", background: "none", fontSize: 18, lineHeight: 1, color: tokens.faint, cursor: "pointer" };
