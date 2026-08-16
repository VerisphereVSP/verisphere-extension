import type { VerityAPI } from "./contract";
import type { ArticleResolveRequest, ArticleResolveResult, Claim, ClaimGroup, Edge, UserStake } from "../shared/types";
import { env } from "../shared/env";
import { bgFetch } from "./bgFetch";
import { writeCreateClaim, writeSetStake } from "../wallet/writer";

/**
 * Real backend adapter — the app API for everything, all via the background
 * worker (bypasses CORS, and the app sees the real user IP for rate limiting):
 *   - resolveArticle → /claims/locate (phrase lookup + lexical/pgvector match)
 *   - claim reads → /claims/... (indexed summaries, plus /live for chain truth)
 *   - writes → wallet/writer (direct-submit or gasless relay by wallet mode)
 */

const appBase = env.appApiBase;

/** Map the app's snake_case claim summary → the extension's Claim. */
function toClaim(j: any): Claim {
  return {
    postId: j.post_id,
    text: j.text ?? "",
    evs: j.verity_score ?? 0,
    baseVs: j.base_vs ?? 0,
    supportStake: j.stake_support ?? 0,
    challengeStake: j.stake_challenge ?? 0,
    totalStake: j.total_stake ?? 0,
    active: j.is_active ?? false,
    incomingCount: j.incoming_count ?? 0,
    outgoingCount: j.outgoing_count ?? 0,
  };
}

export const httpApi: VerityAPI = {
  async resolveArticle(req: ArticleResolveRequest): Promise<ArticleResolveResult> {
    const res = await bgFetch<{ groups?: any[]; fluff?: string[]; error?: string }>(`${appBase}/claims/locate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok || !res.json) {
      throw new Error(res.json?.error ?? res.error ?? `resolve ${res.status}`);
    }
    const groups: ClaimGroup[] = (res.json.groups ?? []).map((g) => ({
      groupId: g.group_id,
      canonicalText: g.canonical_text ?? "",
      sentenceIds: g.sentence_ids ?? [],
      status: g.status,
      matchScore: g.match_score,
      claim: g.claim ? toClaim(g.claim) : undefined,
    }));
    return { groups, fluff: res.json.fluff ?? [] };
  },

  async getClaim(postId: number): Promise<Claim> {
    const res = await bgFetch<any>(`${appBase}/claims/${postId}/summary`);
    if (!res.ok || !res.json) throw new Error(res.error ?? `getClaim ${res.status}`);
    const claim = toClaim(res.json);
    // The app indexer lags the chain by minutes — and the derived is_active
    // flag lags separately, so a funded claim can report inactive (or unstaked)
    // long after the stake landed. Whenever the summary says inactive, reconcile
    // against the live on-chain totals so a claim above the activity threshold
    // doesn't render as "below the activity threshold / nothing staked". Guard
    // against a briefly-trailing RPC clobbering fresher app totals downward.
    if (!claim.active) {
      const live = await liveTotals(postId);
      if (live && live.total >= claim.totalStake) applyLive(claim, live);
    }
    return claim;
  },

  async getEdges(postId: number): Promise<{ incoming: Edge[]; outgoing: Edge[] }> {
    const res = await bgFetch<{ incoming: any[]; outgoing: any[] }>(`${appBase}/claims/${postId}/edges`);
    if (!res.ok || !res.json) return { incoming: [], outgoing: [] };
    const map = (e: any): Edge => ({
      linkPostId: e.link_post_id,
      otherPostId: e.claim_post_id,
      otherText: e.claim_text ?? "",
      isChallenge: !!e.is_challenge,
      contribution: e.edge_contribution ?? 0,
    });
    return { incoming: res.json.incoming.map(map), outgoing: res.json.outgoing.map(map) };
  },

  async getUserStake(postId: number, address: string): Promise<UserStake> {
    const res = await bgFetch<{ user_support?: number; user_challenge?: number }>(
      `${appBase}/claims/${postId}/user-stake?user=${address}`,
    );
    return {
      postId,
      userSupport: res.json?.user_support ?? 0,
      userChallenge: res.json?.user_challenge ?? 0,
    };
  },

  async setStake(postId: number, targetVsp: number): Promise<Claim> {
    // Snapshot the pre-stake on-chain total so we can tell when the app's RPC
    // node has actually observed our change (see the poll below).
    const before = await liveTotals(postId);
    const prevTotal = before?.total ?? 0;

    await writeSetStake(postId, targetVsp);

    // Stake amounts come from the CHAIN (source of truth, reflects the tx we
    // just confirmed); score/edges come from the app summary and lag until the
    // indexer catches up — that's honest, scoring genuinely hasn't run yet.
    const claim = await httpApi.getClaim(postId).catch(() => minimalClaim(postId, ""));

    // The app's RPC node can trail the wallet's by a moment right after the
    // receipt, so the first live read may still return the PRE-stake totals —
    // which rendered a just-created+staked claim as "nothing staked / grey"
    // until a reload. Poll briefly until the total reflects the confirmed
    // change (or we run out of tries, in which case the reload path recovers).
    let live = await liveTotals(postId);
    for (let i = 0; i < 6 && (!live || live.total === prevTotal); i++) {
      await new Promise((r) => setTimeout(r, 800));
      live = await liveTotals(postId);
    }
    if (live) applyLive(claim, live);
    return claim;
  },

  async createClaim(text: string): Promise<{ claim: Claim; deduped: boolean }> {
    const { postId, deduped } = await writeCreateClaim(text);
    let pid = postId;
    // Direct-path creates don't learn the post id from the tx — resolve it by
    // exact text. RETRY briefly: the create-and-stake flow depends on this id,
    // and a single missed lookup used to silently skip the stake.
    for (let i = 0; pid == null && i < 5; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const chk = await bgFetch<{ exists?: boolean; post_id?: number | null }>(
        `${appBase}/claims/check-onchain?text=${encodeURIComponent(text)}`,
      );
      if (chk.json?.post_id != null) pid = chk.json.post_id;
    }
    if (pid != null) {
      // No corpus seeding needed: the app's chain indexer picks up PostCreated
      // within a poll cycle and embeds the claim, so it becomes matchable (and
      // underlines for everyone) on its own within seconds.
      try {
        return { claim: await httpApi.getClaim(pid), deduped };
      } catch {
        /* not indexed yet */
      }
    }
    // Freshly created but not yet indexed — show the text with neutral stats.
    return { claim: minimalClaim(pid ?? -1, text), deduped };
  },
};

interface LiveTotals {
  support: number;
  challenge: number;
  total: number;
  active: boolean;
  baseVs: number | null;
  effectiveVs: number | null;
}

/** Live contract state read straight from the chain (never lags the indexer). */
async function liveTotals(postId: number): Promise<LiveTotals | null> {
  if (postId < 0) return null;
  const res = await bgFetch<{
    support_vsp?: number;
    challenge_vsp?: number;
    active?: boolean;
    base_vs?: number | null;
    effective_vs?: number | null;
  }>(`${appBase}/claims/${postId}/live`);
  if (!res.ok || !res.json) return null;
  const support = res.json.support_vsp ?? 0;
  const challenge = res.json.challenge_vsp ?? 0;
  return {
    support,
    challenge,
    total: support + challenge,
    active: !!res.json.active,
    baseVs: res.json.base_vs ?? null,
    effectiveVs: res.json.effective_vs ?? null,
  };
}

function applyLive(claim: Claim, live: LiveTotals) {
  claim.supportStake = live.support;
  claim.challengeStake = live.challenge;
  claim.totalStake = live.total;
  claim.active = live.active;
  if (live.baseVs != null) claim.baseVs = live.baseVs;
  if (live.effectiveVs != null) claim.evs = live.effectiveVs;
}

function minimalClaim(postId: number, text: string): Claim {
  return {
    postId, text, evs: 0, baseVs: 0, supportStake: 0, challengeStake: 0,
    totalStake: 0, active: false, incomingCount: 0, outgoingCount: 0,
  };
}
