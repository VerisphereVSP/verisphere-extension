import type { RelayConfig } from "./relayConfig";

/**
 * Client-side verification of server-built calldata.
 *
 * /relay/build keeps ABIs and encoding on the server so the extension stays
 * thin and a contract change doesn't strand installed clients behind store
 * review. The cost is signing bytes we didn't produce. This module closes most
 * of that gap without shipping an ABI encoder: the three actions we ever
 * request have fixed, tiny calldata layouts, so we hard-code their 4-byte
 * selectors and DECODE the server's bytes, checking every field against what
 * the user actually asked for. A compromised or buggy backend then can't
 * redirect a stake to a different claim, publish different text under the
 * user's signature, or point an approval at a different spender — it can only
 * produce a transaction we refuse to sign.
 *
 * The `to` checks verify against the cached /relay/config addresses. Since the
 * same origin serves both, this is consistency rather than independent proof —
 * but the config is fetched once per session, so a backend compromised
 * mid-session still can't redirect an already-configured client.
 */

const SELECTORS = {
  setStake: "b1cf8aac", // setStake(uint256,int256)
  createClaim: "84c08ed3", // createClaim(string)
  approve: "095ea7b3", // approve(address,uint256)
} as const;

export type BuildAction = keyof typeof SELECTORS;

export interface BuildParams {
  postId?: number;
  targetVsp?: number;
  text?: string;
  spender?: string;
}

const MAX_UINT256 = (1n << 256n) - 1n;
const TWO_255 = 1n << 255n;
const TWO_256 = 1n << 256n;

function fail(action: string, why: string): never {
  throw new Error(
    `Refusing to sign: server-built ${action} calldata failed verification (${why}). ` +
      `This can mean an out-of-date extension or a compromised backend.`,
  );
}

/** The i-th 32-byte argument word (hex, no 0x, selector already stripped). */
function word(body: string, i: number, action: string): string {
  const w = body.slice(i * 64, i * 64 + 64);
  if (w.length !== 64) fail(action, `missing argument word ${i}`);
  return w;
}

function toBig(w: string): bigint {
  return BigInt("0x" + w);
}

function toInt256(w: string): bigint {
  const v = toBig(w);
  return v >= TWO_255 ? v - TWO_256 : v;
}

function toAddress(w: string, action: string): string {
  if (!w.startsWith("0".repeat(24))) fail(action, "address word has non-zero upper bytes");
  return "0x" + w.slice(24);
}

function decodeStringArg(body: string, action: string): string {
  if (toBig(word(body, 0, action)) !== 32n) fail(action, "unexpected string head offset");
  const len = Number(toBig(word(body, 1, action)));
  const hex = body.slice(2 * 64, 2 * 64 + len * 2);
  if (hex.length !== len * 2) fail(action, "string bytes truncated");
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

function sameAddr(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** Throws unless the server's {to, data, permitValueWei} encodes exactly the
 *  action and arguments the user asked for. */
export function verifyBuiltTx(
  action: BuildAction,
  built: { to: string; data: string; permitValueWei?: string },
  cfg: RelayConfig,
  params: BuildParams,
): void {
  const data = (built.data || "").toLowerCase();
  if (!/^0x[0-9a-f]{8,}$/.test(data)) fail(action, "calldata is not hex");
  if (!data.startsWith("0x" + SELECTORS[action])) fail(action, "wrong function selector");
  const body = data.slice(10); // past 0x + selector
  const permit = built.permitValueWei;

  if (action === "setStake") {
    const { postId, targetVsp } = params;
    if (typeof postId !== "number" || typeof targetVsp !== "number") {
      fail(action, "caller did not supply postId/targetVsp to verify against");
    }
    if (!sameAddr(built.to, cfg.addresses.stakeEngine)) fail(action, "to is not the StakeEngine");
    if (body.length !== 2 * 64) fail(action, "unexpected calldata length");
    if (toBig(word(body, 0, action)) !== BigInt(postId)) fail(action, "postId was substituted");

    const target = toInt256(word(body, 1, action));
    const sameSign = targetVsp > 0 ? target > 0n : targetVsp < 0 ? target < 0n : target === 0n;
    if (!sameSign) fail(action, "stake side was flipped");
    // The server derives wei from the same float we hold, so allow only
    // float-rounding slack (1e-9 VSP absolute, 1ppb relative) — nothing more.
    const absTarget = target < 0n ? -target : target;
    const expected = Math.abs(targetVsp) * 1e18;
    const diff = Math.abs(Number(absTarget) - expected);
    if (diff > Math.max(1e9, expected * 1e-9)) fail(action, "stake amount was changed");
    if (permit !== undefined) {
      const want = target === 0n ? "0" : absTarget.toString();
      if (BigInt(permit) !== BigInt(want)) fail(action, "permit value does not match the stake");
    }
    return;
  }

  if (action === "createClaim") {
    const text = params.text;
    if (typeof text !== "string") fail(action, "caller did not supply text to verify against");
    if (!sameAddr(built.to, cfg.addresses.postRegistry)) fail(action, "to is not the PostRegistry");
    if (decodeStringArg(body, action) !== text.trim()) fail(action, "claim text was altered");
    if (permit !== undefined && BigInt(permit) !== BigInt(cfg.postingFeeWei)) {
      fail(action, "permit value does not match the posting fee");
    }
    return;
  }

  // approve
  const spender = params.spender;
  if (typeof spender !== "string") fail(action, "caller did not supply spender to verify against");
  if (!sameAddr(built.to, cfg.addresses.vspToken)) fail(action, "to is not the VSP token");
  if (body.length !== 2 * 64) fail(action, "unexpected calldata length");
  if (!sameAddr(toAddress(word(body, 0, action), action), spender)) fail(action, "spender was substituted");
  if (toBig(word(body, 1, action)) !== MAX_UINT256) fail(action, "unexpected approval amount");
  if (permit !== undefined && BigInt(permit) !== 0n) fail(action, "approve must not carry a permit value");
}
