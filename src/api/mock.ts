import type { VeriSphereAPI } from "./contract";
import type {
  ArticleResolveRequest,
  ArticleResolveResult,
  Claim,
  ClaimGroup,
  Edge,
  UserStake,
} from "../shared/types";

/**
 * Mock backend so the FE runs live on a real Wikipedia page with no server.
 * Matching is deterministic (keyword-based) so highlights are reproducible for
 * demos. This is thrown away once the real HTTP adapter lands.
 */

const store = new Map<number, Claim>();
const userStakes = new Map<string, UserStake>();
let nextId = 1000;

function makeClaim(text: string, evs: number, active = true): Claim {
  const support = active ? Math.round(20 + Math.abs(evs)) : 0.4;
  const challenge = active ? Math.round(20 + Math.max(0, -evs)) : 0.2;
  const claim: Claim = {
    postId: nextId++,
    text,
    evs,
    baseVs: evs,
    supportStake: support,
    challengeStake: challenge,
    totalStake: support + challenge,
    active,
    incomingCount: Math.floor(Math.random() * 4),
    outgoingCount: Math.floor(Math.random() * 3),
  };
  store.set(claim.postId, claim);
  return claim;
}

// A few keyword rules that produce interesting, deterministic states.
const RULES: { re: RegExp; evs: number; active?: boolean }[] = [
  { re: /\b(founded|established|born|died|located)\b/i, evs: 78 },
  { re: /\b(largest|smallest|first|oldest|highest)\b/i, evs: 41 },
  { re: /\b(believed|reportedly|alleged|controversial|disputed)\b/i, evs: -34 },
  { re: /\b(estimated|approximately|about)\b/i, evs: 12, active: false },
];

function delay<T>(v: T, ms = 180): Promise<T> {
  return new Promise((r) => setTimeout(() => r(v), ms));
}

export const mockApi: VeriSphereAPI = {
  async resolveArticle(req: ArticleResolveRequest): Promise<ArticleResolveResult> {
    // Deterministic demo matching: rule-matched sentences become on-chain
    // groups (canonical = the sentence), the rest are fluff. Sentences sharing
    // the same first-8-words merge into one group so the multi-sentence group
    // UX is demoable.
    const groups = new Map<string, ClaimGroup>();
    const fluff: string[] = [];
    const sentences = req.sentences;
    for (const s of sentences) {
      const rule = RULES.find((r) => r.re.test(s.text));
      const eligible = !rule && hash(s.sentenceId) % 6 === 0 && s.text.length > 60;
      if (!rule && !eligible) {
        fluff.push(s.sentenceId);
        continue;
      }
      const norm = s.text.toLowerCase().split(/\s+/).slice(0, 8).join(" ");
      let group = groups.get(norm);
      if (!group) {
        const active = rule ? rule.active !== false : false;
        group = {
          // Content-derived id (like the server's) so groups merge across batches.
          groupId: `mock-g${hash(norm)}`,
          canonicalText: s.text,
          sentenceIds: [],
          status: rule ? (active ? "mapped" : "low-liquidity") : "eligible",
          matchScore: rule ? 0.92 : undefined,
          claim: rule ? makeClaim(s.text, rule.evs, rule.active !== false) : undefined,
        };
        groups.set(norm, group);
      }
      group.sentenceIds.push(s.sentenceId);
    }
    return delay({ groups: [...groups.values()], fluff }, 600);
  },

  async getClaim(postId) {
    const c = store.get(postId);
    if (!c) throw new Error("claim not found");
    return delay(c);
  },

  async getEdges(postId) {
    const c = store.get(postId);
    const incoming: Edge[] = c && c.incomingCount > 0
      ? [{ linkPostId: postId + 1, otherPostId: postId + 2, otherText: "Supporting source claim", isChallenge: false, contribution: 14 }]
      : [];
    const outgoing: Edge[] = [];
    return delay({ incoming, outgoing });
  },

  async getUserStake(postId, address) {
    return delay(
      userStakes.get(`${address}:${postId}`) ?? {
        postId,
        userSupport: 0,
        userChallenge: 0,
      },
    );
  },

  async setStake(postId, targetVsp, _signer, address) {
    // Demo write: no signature needed. Materialize a placeholder if the claim
    // came from the real backend (http mode) and isn't in the mock store.
    let c = store.get(postId);
    if (!c) {
      c = { postId, text: "", evs: 0, baseVs: 0, supportStake: 0, challengeStake: 0, totalStake: 0, active: false, incomingCount: 0, outgoingCount: 0 };
      store.set(postId, c);
    }
    userStakes.set(`${address}:${postId}`, {
      postId,
      userSupport: targetVsp > 0 ? targetVsp : 0,
      userChallenge: targetVsp < 0 ? -targetVsp : 0,
    });
    if (targetVsp > 0) c.supportStake += targetVsp;
    else if (targetVsp < 0) c.challengeStake += -targetVsp;
    c.totalStake = c.supportStake + c.challengeStake;
    c.evs = c.totalStake
      ? Math.round(((c.supportStake - c.challengeStake) / c.totalStake) * 100)
      : 0;
    c.active = c.totalStake >= 1;
    return delay(c, 400);
  },

  async createClaim(text, _signer, _address) {
    const existing = [...store.values()].find(
      (c) => c.text.trim().toLowerCase() === text.trim().toLowerCase(),
    );
    if (existing) return delay({ claim: existing, deduped: true }, 400);
    return delay({ claim: makeClaim(text, 0, false), deduped: false }, 400);
  },
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
