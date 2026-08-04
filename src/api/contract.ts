import type {
  ArticleResolveRequest,
  ArticleResolveResult,
  Claim,
  Edge,
  UserStake,
} from "../shared/types";

/**
 * VerityAPI — the contract for Verity's backends. Claim reads/writes map onto
 * the app's endpoints (`/api/claims/*`, `/relay`, `/token/balance`);
 * `resolveArticle` is the verity-api gateway's claim matcher (article sentences
 * + salient phrases → on-chain claim groups located in our own claim corpus).
 *
 * NOTE: claim *validation* checks do not live here — they are split by source
 * (local heuristics, app moderation/dedup, and the verity-api atomicity service)
 * and orchestrated in `api/checks.ts` + `shared/claimChecks.ts`.
 */
export interface VerityAPI {
  /**
   * Locate on-chain claims in a batch of article sentences (verity-api: phrase
   * candidate lookup + local pgvector search + summaries). Called lazily as
   * sentences scroll into view; groups merge across batches by group id.
   */
  resolveArticle(req: ArticleResolveRequest): Promise<ArticleResolveResult>;

  /** Full claim detail for the side panel. */
  getClaim(postId: number): Promise<Claim>;

  /** Incoming + outgoing evidence edges for a claim. */
  getEdges(postId: number): Promise<{ incoming: Edge[]; outgoing: Edge[] }>;

  /** The connected user's live position on a claim. */
  getUserStake(postId: number, address: string): Promise<UserStake>;

  /**
   * Stake to a target net position (VSP). Positive = support, negative =
   * challenge, 0 = withdraw. Mirrors StakeEngine.setStake via the relay.
   */
  setStake(
    postId: number,
    targetVsp: number,
    signer: TypedDataSigner,
    address: string,
  ): Promise<Claim>;

  /**
   * Create a claim. The caller is expected to have already validated it (see
   * checks). Returns an existing claim with deduped=true if one matches.
   */
  createClaim(
    text: string,
    signer: TypedDataSigner,
    address: string,
  ): Promise<{ claim: Claim; deduped: boolean }>;
}

/** Minimal EIP-712 signer the API needs — implemented by the wallet layer. */
export interface TypedDataSigner {
  signTypedData(payload: unknown): Promise<string>;
}
