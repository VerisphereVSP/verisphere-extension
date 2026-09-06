import type {
  ArticleResolveRequest,
  ArticleResolveResult,
  Claim,
  Edge,
  UserStake,
} from "../shared/types";

/**
 * VerisphereAPI — the contract for Verisphere's backend. Everything maps onto the app's
 * endpoints (`/api/claims/*`, `/relay`, `/token/balance`), including
 * `resolveArticle`, the claim matcher (article sentences + salient phrases →
 * on-chain claim groups located in the app's claim corpus).
 *
 * NOTE: claim *validation* checks do not live here — they are split by source
 * (local heuristics, and the app's moderation/dedup/atomicity endpoints) and
 * orchestrated in `api/checks.ts` + `shared/claimChecks.ts`.
 */
export interface VerisphereAPI {
  /**
   * Locate on-chain claims in a batch of article sentences (phrase candidate
   * lookup + lexical/pgvector match + summaries). Called lazily as sentences
   * scroll into view; groups merge across batches by group id.
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
