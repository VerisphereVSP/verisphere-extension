/// <reference types="vite/client" />
/// <reference types="@crxjs/vite-plugin/client" />

interface ImportMetaEnv {
  readonly VITE_APP_API_BASE?: string;
  readonly VITE_API_MODE?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_BUY_VSP_URL?: string;
  readonly VITE_PORTFOLIO_URL?: string;
  readonly VITE_MIN_AVAX_FOR_GAS?: string;
  readonly VITE_ALLOW_HTTP_API_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
