# Verisphere extension

The Verisphere truth-staking overlay for Wikipedia (MV3 browser extension).

Open any Wikipedia article and the extension highlights the sentences that map
to on-chain Verisphere **claims**, colored by their **Verity Score**. Hover to
preview, click to open the side panel, then **stake** on a claim or **create**
a new one from a sentence — all gasless via the Verisphere relay (the wallet
only signs; it never pays gas).

## Status: FE-first scaffold

This package is built **frontend-first**. It runs today against **mock**
adapters so you can load it on a real Wikipedia page with no backend:

- `src/api/contract.ts` — the `VerisphereAPI` interface the backend must satisfy.
- `src/api/mock.ts` — deterministic mock so highlights are demoable standalone.
- `src/wallet/wallet.ts` — the wallet interface (sign-typed-data only) + a mock signer.

Building the backend "backwards" means implementing `VerisphereAPI` over the
existing `app` endpoints (`/api/claims/*`, `/relay/async`, `/token/balance`)
plus one new endpoint: **batch sentence → claim resolution** (`resolveSentences`).
The real wallet is a WalletConnect v2 signer behind the same `Wallet` interface.

## Architecture

- **Content script** (`src/content/`) runs on `*.wikipedia.org/wiki/*`:
  - `sentences.ts` extracts sentences + offsets from the article body.
  - `highlighter.ts` paints claim marks into the **page** (light DOM) so they
    integrate with the text; marks talk to the overlay via a `verisphere:*`
    event bus (`store.ts`).
  - `overlay.tsx` mounts a **shadow-DOM** React app (launcher, hover card,
    docked side panel) so our styles never collide with Wikipedia's.
- **Popup** (`src/popup/`) — wallet connect + overlay on/off.
- **Background** (`src/background/`) — thin; grows into API proxy + WC session.

Shared visual language (`shared/vsColor.ts`, `shared/tokens.ts`) is ported from
the Verisphere web app so the overlay matches it.

## Develop

```bash
npm install
npm run build      # outputs dist/ — load unpacked in chrome://extensions
npm run dev        # HMR dev build
```

Then load `dist/` (or the dev server output) via
`chrome://extensions → Load unpacked`, and open e.g.
`https://en.wikipedia.org/wiki/Bitcoin`.

## Releases

- **0.1.3** (2026-10-25) — mainnet store build (app.verisphere.co). Same code as 0.1.2; the package published as 0.1.2 had been built against the test network, so it showed Fuji balances. patch_ext_v013
- **0.1.2** (2026-10-21) — Buy / Sell VSP inside the panel (AVAX or USDC; the app plans the swap, the extension verifies every field before the wallet signs), a sentence that states several claims offers all of them (app `/api/claims/locate` multi-claim), usability fixes. Relay-fee permits now name the FeeCollector contract (server-side; no client change).
- **0.1.1** (2026-10-16) — standing allowances: one wallet prompt per action in steady state.
- **0.1.0** — first store build.

## Publish (Chrome Web Store) <!-- patch_ext_release -->

```bash
npm run release    # tsc → vite build --mode production → scripts/release.mjs → release/verisphere-extension-<version>.zip
```

`release.mjs` refuses a build whose manifest or bundles mention a dev host (localhost, test.verisphere.co, *.example),
whose `host_permissions` differ from `.env.production`'s API origin, or whose manifest carries a `key`. Upload the zip it
prints — nothing else. Before each upload: bump `version` in `src/manifest.ts` (the store rejects a re-used version),
load `dist/` unpacked once and stake on a live Wikipedia page against production, and check the listing fields:

- Privacy policy URL: `https://app.verisphere.co/docs/viewer.html?file=privacy.md` (covers the extension, §1).
- Support contact: `support@verisphere.co`. Homepage: `https://verisphere.co`.
- Permissions justification: `storage` (the on/off switch and selected wallet), `activeTab` (none beyond the content
  script), host `*.wikipedia.org` (where the overlay runs), host `app.verisphere.co/api` (claims, scores, relay).
  No remote code; no RPC host — chain reads and signatures go through the page's injected wallet.
- Single purpose: highlight stakeable factual claims on Wikipedia and let the reader stake on them via Verisphere.
