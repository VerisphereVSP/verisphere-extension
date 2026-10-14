import { defineManifest } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";

// patch_ext_release: the manifest is a function of the Vite mode so that the
// store build (`--env production`) declares exactly the hosts it uses — the app
// API origin from .env.production — and nothing from dev (localhost, test host).
// The extension never calls an RPC node itself: chain reads and signatures go
// through the page's injected wallet, so no Avalanche RPC host is declared.
export default defineManifest((env) => {
  const vars = loadEnv(env.mode, process.cwd(), "VITE_");
  const apiBase = vars.VITE_APP_API_BASE ?? "https://test.verisphere.co/api";
  const apiOrigin = new URL(apiBase).origin;
  const hostPermissions =
    env.mode === "production"
      ? ["*://*.wikipedia.org/*", `${apiOrigin}/api/*`]
      : ["*://*.wikipedia.org/*", "http://localhost:8070/*", `${apiOrigin}/api/*`];
  return {
  manifest_version: 3,
  name: "Verisphere — Truth-staking for Wikipedia",
  version: "0.1.0",
  description:
    "Highlights stakeable factual claims on Wikipedia, shows their on-chain Verity Score, and lets you stake or create claims.",
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_title: "Verisphere",
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
    },
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["*://*.wikipedia.org/wiki/*"],
      js: ["src/content/index.tsx"],
      run_at: "document_idle",
    },
    {
      // MAIN-world bridge to the page's injected wallet (window.ethereum).
      matches: ["*://*.wikipedia.org/wiki/*"],
      js: ["src/inpage/index.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
  ],
  // Pages the overlay runs on, plus the app API it calls (see the mode logic above).
  host_permissions: hostPermissions,
  permissions: ["storage", "activeTab"],
  // The pill/panel <img> tags live in the page DOM, so the page must be
  // allowed to load the icon from the extension origin.
  web_accessible_resources: [
    { resources: ["icons/*.png"], matches: ["*://*.wikipedia.org/*"] },
  ],
  };
});
