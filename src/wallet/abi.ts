/**
 * Minimal ABI encoding for the few calls the in-panel VSP trade flow makes or
 * verifies (swap.ts, swapVerify.ts). The extension deliberately ships no ABI
 * library — see verifyBuild.ts for the same stance on the decoding side — and
 * these calls have fixed, tiny layouts, so the encoding is spelled out here and
 * pinned by test/abi.test.ts against eth_abi output.
 *
 * Supported argument kinds: uint256 (bigint), address, address[] (the only
 * dynamic type we need; encoded head-offset + tail per the ABI spec).
 */

export const SELECTORS = {
  // ERC-20
  approve: "0x095ea7b3", // approve(address,uint256)
  balanceOf: "0x70a08231", // balanceOf(address)
  allowance: "0xdd62ed3e", // allowance(address,address)
  // UniswapV2-style router. Uniswap names the wrapped native coin ETH; Trader Joe
  // v1 and Pangolin say AVAX. Same arguments either way.
  swapExactTokensForTokens: "0x38ed1739", // swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
  swapExactETHForTokens: "0x7ff36ab5", // swapExactETHForTokens(uint256,address[],address,uint256)
  swapExactAVAXForTokens: "0xa2a1623d", // swapExactAVAXForTokens(uint256,address[],address,uint256)
  swapExactTokensForETH: "0x18cbafe5", // swapExactTokensForETH(uint256,uint256,address[],address,uint256)
  swapExactTokensForAVAX: "0x676528d1", // swapExactTokensForAVAX(uint256,uint256,address[],address,uint256)
} as const;

export type AbiArg =
  | { t: "uint256"; v: bigint }
  | { t: "address"; v: string }
  | { t: "address[]"; v: string[] };

const WORD_HEX = 64; // hex chars in a 32-byte word
const MAX_UINT256 = (1n << 256n) - 1n;

function uintWord(v: bigint): string {
  if (v < 0n || v > MAX_UINT256) throw new Error("uint256 out of range");
  return v.toString(16).padStart(WORD_HEX, "0");
}

function addressWord(a: string): string {
  const h = a.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`invalid address: ${a}`);
  return h.padStart(WORD_HEX, "0");
}

/** `selector` + ABI-encoded `args`, as the `data` of an eth_call / transaction. */
export function encodeCall(selector: string, args: AbiArg[]): string {
  if (!/^0x[0-9a-f]{8}$/i.test(selector)) throw new Error(`invalid selector: ${selector}`);
  let head = "";
  let tail = "";
  for (const a of args) {
    if (a.t === "uint256") head += uintWord(a.v);
    else if (a.t === "address") head += addressWord(a.v);
    else {
      // Dynamic: the head holds the byte offset (from the start of the args) of
      // this array's tail block; the tail holds length + elements.
      head += uintWord(BigInt((args.length * WORD_HEX + tail.length) / 2));
      tail += uintWord(BigInt(a.v.length)) + a.v.map(addressWord).join("");
    }
  }
  return selector.toLowerCase() + head + tail;
}

/** First return word as an unsigned integer (balanceOf / allowance). */
export function decodeUint(data: string): bigint {
  const h = data.toLowerCase().replace(/^0x/, "");
  if (h.length < WORD_HEX || h.length % WORD_HEX !== 0) throw new Error("malformed return data");
  return BigInt("0x" + h.slice(0, WORD_HEX));
}
