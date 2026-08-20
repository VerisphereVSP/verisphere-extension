import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "VeriSphere — Truth-staking for Wikipedia",
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
    default_title: "VeriSphere",
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
  // Pages the overlay runs on, plus the app API it calls. Includes both local
  // dev and prod hosts so a single build works per env; replace the
  // *.verisphere.example placeholder with your real domain.
  host_permissions: [
    "*://*.wikipedia.org/*",
    "http://localhost:8070/*",
    "https://api.verisphere.example/*",
    "https://verisphere.co/api/*",
    "https://test.verisphere.co/api/*",
    "https://api.avax-test.network/*",
    "https://api.avax.network/*",
  ],
  permissions: ["storage", "activeTab"],
  // The pill/panel <img> tags live in the page DOM, so the page must be
  // allowed to load the icon from the extension origin.
  web_accessible_resources: [
    { resources: ["icons/*.png"], matches: ["*://*.wikipedia.org/*"] },
  ],
});
