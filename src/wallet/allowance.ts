// patch_ext_standing_allowance — how much to permit when an action needs a token allowance.
//
// The extension used to permit the EXACT amount of each action, so every stake raise and every
// claim cost one more "Spending cap request" in the wallet. The web app has permitted a STANDING
// allowance since patch_protocol_gas_fee (10,000 VSP to StakeEngine, 100 posting fees to
// PostRegistry); this module gives the extension the same rule, so one permit covers many actions
// and a permit signed in either client covers the other (the allowance lives on chain per spender).
//
// Why a standing allowance adds no exposure: StakeEngine and PostRegistry can only draw on it
// through a setStake / createClaim the user signs; both are verified protocol contracts governed
// by the 48-hour Timelock and already hold the user's stakes. The relay fee allowance (an EOA
// spender) is NOT widened here — it keeps its security-review bound of 100 VSP (relay.ts).
//
// Pure: no env, no fetch — unit-tested with node:test.

export const STANDING_STAKE_WEI = 10_000n * 10n ** 18n; // 10,000 VSP, or twice the stake if larger
export const POSTING_FEE_MULTIPLE = 100n; // 100 posts per permit

/** Whether the current allowance covers this action (no permit needed). */
export function allowanceCovers(currentWei: bigint, neededWei: bigint): boolean {
  return neededWei <= 0n || currentWei >= neededWei;
}

/** The value to permit for an action that needs `neededWei` from `spender`.
 *  `kind` is derived from the spender address against the relay config (see permitKind). */
export function standingPermitValue(kind: "stake" | "posting" | "other", neededWei: bigint): bigint {
  if (neededWei <= 0n) return 0n;
  if (kind === "stake") return neededWei * 2n > STANDING_STAKE_WEI ? neededWei * 2n : STANDING_STAKE_WEI;
  if (kind === "posting") return neededWei * POSTING_FEE_MULTIPLE;
  return neededWei; // unknown spender: exact amount, as before
}

/** Classify a spender against the configured protocol addresses (case-insensitive). */
export function permitKind(spender: string, addresses: { stakeEngine?: string; postRegistry?: string }): "stake" | "posting" | "other" {
  const s = spender.toLowerCase();
  if (addresses.stakeEngine && s === addresses.stakeEngine.toLowerCase()) return "stake";
  if (addresses.postRegistry && s === addresses.postRegistry.toLowerCase()) return "posting";
  return "other";
}
