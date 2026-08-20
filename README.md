# VeriSphere extension

The VeriSphere truth-staking overlay for Wikipedia (MV3 browser extension).

Open any Wikipedia article and the extension highlights the sentences that map
to on-chain VeriSphere **claims**, colored by their **Verity Score**. Hover to
preview, click to open the side panel, then **stake** on a claim or **create**
a new one from a sentence — all gasless via the VeriSphere relay (the wallet
only signs; it never pays gas).

## Status: FE-first scaffold

This package is built **frontend-first**. It runs today against **mock**
adapters so you can load it on a real Wikipedia page with no backend:

- `src/api/contract.ts` — the `VeriSphereAPI` interface the backend must satisfy.
- `src/api/mock.ts` — deterministic mock so highlights are demoable standalone.
- `src/wallet/wallet.ts` — the wallet interface (sign-typed-data only) + a mock signer.

Building the backend "backwards" means implementing `VeriSphereAPI` over the
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
the VeriSphere web app so the overlay matches it.

## Develop

```bash
npm install
npm run build      # outputs dist/ — load unpacked in chrome://extensions
npm run dev        # HMR dev build
```

Then load `dist/` (or the dev server output) via
`chrome://extensions → Load unpacked`, and open e.g.
`https://en.wikipedia.org/wiki/Bitcoin`.
