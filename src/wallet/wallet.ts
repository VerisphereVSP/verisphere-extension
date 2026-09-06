import type { TypedDataSigner } from "../api/contract";
import type { WalletState, WriteMode } from "../shared/types";
import { env } from "../shared/env";
import { bgFetch } from "../api/bgFetch";
import { providerRequest } from "./bridge";
import { ensureCorrectChain } from "./network";

/** Route writes based on balances (see WriteMode). */
export function writeMode(s: WalletState): WriteMode {
  if (!s.connected || !s.address) return "disconnected";
  if (!s.balancesLoaded) return "loading";
  if (!s.balance || s.balance <= 0) return "needs-vsp";
  if ((s.avax ?? 0) >= env.minAvaxForGas) return "direct";
  return "relay";
}

/**
 * Wallet abstraction.
 *
 * All writes go through the Verisphere relay as EIP-712 meta-transactions
 * (see protocol/src/hooks/useMetaTx.ts), so the wallet never sends a gas
 * transaction — it only needs the address, balance, and typed-data signing.
 *
 * Implementation: an injected EIP-1193 wallet (MetaMask/Rabby) reached through
 * the MAIN-world bridge (src/inpage + wallet/bridge). Works only in the page
 * context (i.e. the side panel), not the popup, since the injected provider
 * lives on the page.
 */
export interface Wallet extends TypedDataSigner {
  getState(): WalletState;
  connect(): Promise<WalletState>;
  /** Silently restore a prior session (eth_accounts — never prompts). */
  restore(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(cb: (s: WalletState) => void): () => void;
}

class InjectedWallet implements Wallet {
  private state: WalletState = { connected: false, address: null, balance: null, avax: null, balancesLoaded: false };
  private subs = new Set<(s: WalletState) => void>();

  getState() {
    return this.state;
  }

  async connect(): Promise<WalletState> {
    const accounts = await providerRequest<string[]>("eth_requestAccounts");
    const address = accounts?.[0] ?? null;
    if (!address) throw new Error("No account returned by the wallet.");
    // Remember the session so page refreshes silently reconnect (restore()).
    void chrome.storage.local.set({ walletConnected: true });
    this.state = { connected: true, address, balance: null, avax: null, balancesLoaded: false };
    this.emit();
    // Get onto the right network before reading balances (AVAX is chain-scoped,
    // and writeMode depends on it). If the user declines, the pre-write guard
    // will re-prompt; we don't block connect.
    try {
      await ensureCorrectChain();
    } catch {
      /* proceed; balances may reflect the wrong chain until switched */
    }
    await this.refreshBalances(address);
    return this.state;
  }

  /**
   * Reconnect without prompting: eth_accounts returns the authorized address
   * (or []) silently. Only runs if the user connected before and didn't
   * explicitly disconnect. No chain-switch prompt here — the pre-write guard
   * re-checks the network when it matters.
   */
  async restore(): Promise<void> {
    try {
      const { walletConnected } = await chrome.storage.local.get("walletConnected");
      if (!walletConnected || this.state.connected) return;
      const accounts = await providerRequest<string[]>("eth_accounts");
      const address = accounts?.[0];
      if (!address) return; // wallet locked or authorization revoked
      this.state = { connected: true, address, balance: null, avax: null, balancesLoaded: false };
      this.emit();
      await this.refreshBalances(address);
    } catch {
      /* silent — the Connect button still works */
    }
  }

  async disconnect(): Promise<void> {
    // Injected wallets have no programmatic disconnect; drop our local session
    // and stop auto-restoring until the user connects again.
    void chrome.storage.local.remove("walletConnected");
    this.state = { connected: false, address: null, balance: null, avax: null, balancesLoaded: false };
    this.emit();
  }

  /**
   * Sign EIP-712 typed data via eth_signTypedData_v4. `typedData` must be a full
   * typed-data object ({domain, types, primaryType, message}); used by the relay
   * write flow (create/stake) once wired.
   */
  async signTypedData(typedData: unknown): Promise<string> {
    if (!this.state.address) throw new Error("Wallet not connected");
    return providerRequest<string>("eth_signTypedData_v4", [
      this.state.address,
      JSON.stringify(typedData),
    ]);
  }

  subscribe(cb: (s: WalletState) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private emit() {
    for (const cb of this.subs) cb(this.state);
  }

  private async refreshBalances(address: string) {
    // VSP (via gateway) + native AVAX (via the injected provider) in parallel.
    const [vsp, avaxHex] = await Promise.all([
      bgFetch<{ balance?: string }>(`${env.appApiBase}/token/balance?address=${address}`)
        .then((r) => r.json?.balance)
        .catch(() => undefined),
      providerRequest<string>("eth_getBalance", [address, "latest"]).catch(() => undefined),
    ]);
    this.state = {
      ...this.state,
      balance: vsp != null ? Number(BigInt(vsp)) / 1e18 : this.state.balance,
      avax: avaxHex != null ? Number(BigInt(avaxHex)) / 1e18 : this.state.avax,
      balancesLoaded: true,
    };
    this.emit();
  }
}

export const wallet: Wallet = new InjectedWallet();
