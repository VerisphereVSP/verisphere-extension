import { env } from "../shared/env";
import { bgFetch } from "../api/bgFetch";
import { wallet } from "./wallet";
import { getRelayConfig, type RelayConfig } from "./relayConfig";
import { verifyBuiltTx, type BuildAction, type BuildParams } from "./verifyBuild";
import { setWriteStage, setFeeQuote } from "./progress";

/**
 * Gasless write path (relay mode: VSP but no AVAX). The app builds the calldata
 * + supplies EIP-712 domains; the wallet signs. Because the user has no AVAX to
 * send an approve tx, allowances are granted via EIP-2612 **permit
 * signatures** that the relay executes before the action:
 *   - posting/stake permit (spender = StakeEngine/PostRegistry)  → `permit`
 *   - fee permit (spender = the fee COLLECTOR = the relay wallet) → `fee_permit`
 * The relay executes `permit` then `fee_permit`, so their nonces must be
 * sequential in that order.
 *
 * patch_ext_gas_fee: the fee is the relay's own gas cost in VSP × one markup
 * knob (no floor, no percentage, no contract carries fee logic). The relay
 * quotes it before signing (GET /relay/estimate-fee); we show it and send the
 * displayed number back as fee_quote_vsp — the relay never charges more. The
 * standing fee allowance is 100 VSP (the security-review bound), renewed below
 * 10 — it was 10,000 to the Forwarder here, which the web app had already cut.
 */

const appBase = env.appApiBase; // calldata build, allowance, nonces, submit

async function getConfig(): Promise<RelayConfig> {
  return getRelayConfig();
}

async function buildTx(action: BuildAction, params: BuildParams): Promise<{ to: string; data: string; permitValueWei: string }> {
  const res = await bgFetch<{ to: string; data: string; permitValueWei: string }>(`${appBase}/relay/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok || !res.json) throw new Error(res.error ?? "Failed to build transaction");
  // Never sign server bytes blind — decode them and check every field against
  // what the user asked for. The permit is later signed for spender=to and
  // value=permitValueWei, so this also bounds what a bad backend could permit.
  verifyBuiltTx(action, res.json, await getConfig(), params);
  return res.json;
}

async function allowanceWei(owner: string, spender: string): Promise<bigint> {
  const res = await bgFetch<{ allowance?: string }>(`${appBase}/token/allowance?owner=${owner}&spender=${spender}`);
  try {
    return BigInt(res.json?.allowance ?? "0");
  } catch {
    return 0n;
  }
}

async function permitNonce(token: string, owner: string): Promise<number> {
  const res = await bgFetch<{ nonce?: number }>(`${appBase}/mm/permit-nonce/${token}/${owner}`);
  return Number(res.json?.nonce ?? 0);
}

const EIP712_DOMAIN = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

const PERMIT_TYPES = {
  EIP712Domain: EIP712_DOMAIN,
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const FORWARD_REQUEST_TYPES = {
  EIP712Domain: EIP712_DOMAIN,
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

interface PermitPayload {
  token: string;
  owner: string;
  spender: string;
  value: string;
  deadline: number;
  v: number;
  r: string;
  s: string;
}

async function signPermit(cfg: RelayConfig, owner: string, spender: string, value: bigint, nonce: number): Promise<PermitPayload> {
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const sig = await wallet.signTypedData({
    domain: { name: cfg.token.name, version: cfg.token.version, chainId: cfg.chainId, verifyingContract: cfg.token.address },
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner, spender, value: value.toString(), nonce, deadline },
  });
  return {
    token: cfg.token.address,
    owner,
    spender,
    value: value.toString(),
    deadline,
    v: parseInt(sig.slice(130, 132), 16),
    r: "0x" + sig.slice(2, 66),
    s: "0x" + sig.slice(66, 130),
  };
}

const FEE_RENEW_WEI = 10n * 10n ** 18n; // renew the standing fee allowance below 10 VSP
const FEE_APPROVE_WEI = 100n * 10n ** 18n; // standing allowance to the collector: 100 VSP

interface FeeQuote {
  fee_total_vsp: number;
  fee_usd?: number;
}

/** The relay's quote for this action, before anything is signed. null when the
 *  backend cannot quote (the submission then decides). */
async function fetchFeeQuote(to: string, data: string, from: string): Promise<FeeQuote | null> {
  const q = new URLSearchParams({ to, calldata: data, from });
  const res = await bgFetch<FeeQuote>(`${appBase}/relay/estimate-fee?${q.toString()}`);
  if (!res.ok || !res.json || typeof res.json.fee_total_vsp !== "number") return null;
  return res.json;
}

interface RelayResult {
  txHash: string;
  status: string;
  claim?: { post_id: number; text: string };
}

async function sendMetaTx(to: string, data: string, permitValueWei: bigint, gas = 800_000): Promise<RelayResult> {
  const cfg = await getConfig();
  const owner = wallet.getState().address;
  if (!owner) throw new Error("Wallet not connected");
  const forwarder = cfg.forwarder.address;
  // patch_ext_gas_fee: the fee collector is the relay wallet (from /relay/config);
  // an older backend without it still runs the Forwarder's schedule.
  const feeSpender = cfg.feeCollector || forwarder;

  // Decide which permits are needed (skip if allowance already sufficient).
  const [spendAllow, feeAllow, baseNonce, quote] = await Promise.all([
    permitValueWei > 0n ? allowanceWei(owner, to) : Promise.resolve(0n),
    allowanceWei(owner, feeSpender),
    permitNonce(cfg.token.address, owner),
    fetchFeeQuote(to, data, owner),
  ]);
  setFeeQuote(quote ? quote.fee_total_vsp : null);

  let n = baseNonce;
  let permit: PermitPayload | undefined;
  let fee_permit: PermitPayload | undefined;
  setWriteStage("awaiting-wallet"); // the user signs the permits + forward request, one at a time
  // The relay executes `permit` before `fee_permit`, so assign nonces in order.
  if (permitValueWei > 0n && spendAllow < permitValueWei) {
    permit = await signPermit(cfg, owner, to, permitValueWei, n);
    n++;
  }
  if (feeAllow < FEE_RENEW_WEI) {
    fee_permit = await signPermit(cfg, owner, feeSpender, FEE_APPROVE_WEI, n);
    n++;
  }

  // ForwardRequest
  const nonceRes = await bgFetch<{ nonce: number }>(`${appBase}/relay/nonce/${owner}`);
  const nonce = nonceRes.json?.nonce ?? 0;
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const message = { from: owner, to, value: 0, gas, nonce, deadline, data };
  const signature = await wallet.signTypedData({
    domain: { name: cfg.forwarder.name, version: cfg.forwarder.version, chainId: cfg.chainId, verifyingContract: forwarder },
    types: FORWARD_REQUEST_TYPES,
    primaryType: "ForwardRequest",
    message,
  });

  setWriteStage("submitting");
  const res = await bgFetch<{ tx_hash: string; status: string; claim?: { post_id: number; text: string }; detail?: string }>(
    `${appBase}/relay/async`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: message, signature, permit, fee_permit,
        fee_quote_vsp: quote ? quote.fee_total_vsp : undefined, // patch_ext_gas_fee: never charged more than shown
      }),
    },
  );
  if (!res.ok || !res.json) throw new Error(res.json?.detail ?? res.error ?? `relay ${res.status}`);
  return { txHash: res.json.tx_hash, status: res.json.status, claim: res.json.claim };
}

export async function relaySetStake(postId: number, targetVsp: number): Promise<void> {
  const { to, data, permitValueWei } = await buildTx("setStake", { postId, targetVsp });
  await sendMetaTx(to, data, BigInt(permitValueWei));
}

export async function relayCreateClaim(text: string): Promise<{ postId: number | null; deduped: boolean }> {
  const { to, data, permitValueWei } = await buildTx("createClaim", { text });
  const res = await sendMetaTx(to, data, BigInt(permitValueWei));
  if (res.status === "duplicate_claim" && res.claim) return { postId: res.claim.post_id, deduped: true };
  return { postId: res.claim?.post_id ?? null, deduped: false };
}
