/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_API_BASE?: string;
  readonly VITE_VERITY_API_URL?: string;
  readonly VITE_API_MODE?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_BUY_VSP_URL?: string;
  readonly VITE_PORTFOLIO_URL?: string;
  readonly VITE_MIN_AVAX_FOR_GAS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
