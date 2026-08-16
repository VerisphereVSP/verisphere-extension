import { env } from "../shared/env";
import { bgFetch } from "../api/bgFetch";
import { wallet } from "./wallet";
import { providerRequest } from "./bridge";
import { ensureCorrectChain } from "./network";
import { getRelayConfig } from "./relayConfig";
import { verifyBuiltTx, type BuildAction, type BuildParams } from "./verifyBuild";
import { setWriteStage } from "./progress";

/**
 * Direct-submit write path for wallets that hold AVAX: the user pays their own
 * gas via eth_sendTransaction (no relay, no relay fee, no permits). We still
 * need a token allowance for the spender, so we approve (max, one-time) first
 * when it's insufficient. Calldata comes from the app (/relay/build).
 */

const appBase = env.appApiBase; // calldata build, allowance

async function build(action: BuildAction, params: BuildParams): Promise<{ to: string; data: string }> {
  const res = await bgFetch<{ to: string; data: string }>(`${appBase}/relay/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok || !res.json) throw new Error(res.error ?? "Failed to build transaction");
  // Never sign server bytes blind — decode them and check every field against
  // what the user asked for. Especially load-bearing here: ensureAllowance
  // approves the returned `to`, so an unverified `to` would control both the
  // tx destination and the token approval.
  verifyBuiltTx(action, res.json, await getRelayConfig(), params);
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

function from(): string {
  const a = wallet.getState().address;
  if (!a) throw new Error("Wallet not connected");
  return a;
}

async function sendTx(to: string, data: string): Promise<string> {
  return providerRequest<string>("eth_sendTransaction", [{ from: from(), to, data }]);
}

async function waitForReceipt(hash: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await providerRequest<{ status?: string } | null>("eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status === "0x0") throw new Error("Transaction reverted on-chain");
      return;
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error("Timed out waiting for confirmation");
}

/** Approve the spender (max) if the current allowance is below `requiredVsp`. */
async function ensureAllowance(spender: string, requiredVsp: number): Promise<void> {
  const requiredWei = BigInt(Math.max(1, Math.ceil(Math.abs(requiredVsp)))) * 10n ** 18n;
  if ((await allowanceWei(from(), spender)) >= requiredWei) return;
  setWriteStage("approving");
  const { to, data } = await build("approve", { spender });
  await waitForReceipt(await sendTx(to, data));
}

export async function directSetStake(postId: number, targetVsp: number): Promise<void> {
  await ensureCorrectChain();
  const { to, data } = await build("setStake", { postId, targetVsp });
  // StakeEngine escrows VSP for support AND challenge positions — any nonzero
  // target needs allowance for |target| (to = StakeEngine).
  if (targetVsp !== 0) await ensureAllowance(to, Math.abs(targetVsp));
  setWriteStage("awaiting-wallet");
  const hash = await sendTx(to, data);
  setWriteStage("confirming");
  await waitForReceipt(hash);
}

export async function directCreateClaim(text: string): Promise<{ postId: number | null; deduped: boolean }> {
  await ensureCorrectChain();
  const { to, data } = await build("createClaim", { text });
  await ensureAllowance(to, 1); // posting fee ≈ 1 VSP; to = PostRegistry
  setWriteStage("awaiting-wallet");
  const hash = await sendTx(to, data);
  setWriteStage("confirming");
  await waitForReceipt(hash);
  return { postId: null, deduped: false }; // caller resolves post_id after indexing
}
