import type { ClaimGroup } from "../shared/types";

/**
 * Order a sentence's claim groups for display when one sentence states several
 * claims ("Climate change threatens people with increased flooding, extreme
 * heat, …" can match a flooding claim and a heat claim). The first is the one
 * the underline and hover card show; the panel offers all of them.
 *
 * On-chain claims come before ones not yet created, the most-staked first;
 * ties keep the resolver's order. Pure — unit-tested with node:test.
 */
export function rankGroups(gs: ClaimGroup[]): ClaimGroup[] {
  return gs
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const onChain = (a.g.claim ? 0 : 1) - (b.g.claim ? 0 : 1);
      if (onChain !== 0) return onChain;
      const stake = (b.g.claim?.totalStake ?? 0) - (a.g.claim?.totalStake ?? 0);
      if (stake !== 0) return stake;
      return a.i - b.i;
    })
    .map((x) => x.g);
}
