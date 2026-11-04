# Verisphere extension

Spot misinformation on any page (MV3 browser extension).  Truth-staking for the web.

**Check any sentence on any site** (0.1.4): select it → right-click → *Check on Verisphere* (or the toolbar button).
The side panel opens with the claims it states and where the stake stands on each — stake, create the claim if nobody
has, share it with the standing and a link, or put VSP on the table for a friend. The overlay is injected into that tab
only, on that gesture (`activeTab` + `scripting`); no site is read until the reader asks.

On English Wikipedia the extension also highlights the sentences that map to on-chain **claims**, colored by their
**Verity Score**. Hover to preview, click to open the side panel, then **stake** on a claim or **create** a new one from
a sentence — all gasless via the Verisphere relay (the wallet only signs; it never pays gas). Staking in the panel uses
the page's MetaMask; *Back it in the app* hands a passkey user to the app's Start sheet (`/claims?post=&side=&start=1`).

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

- **0.1.7** (2026-11-04) — the Web Store rejected 0.1.4 under its gambling / prediction-market policy (ref. "Grey
  Copper"); 0.1.3 had passed with the same mechanics. The difference was the copy, which foregrounded gaining and
  losing VSP. 0.1.7 is 0.1.6 with the copy reframed around what the extension does for a reader — check a claim
  against a stake-weighted credibility score — with staking described, not sold: no "take a side", no "on the table",
  no gains/losses anywhere in the package or the listing — and the single purpose stated as what it is for a reader:
  spotting misinformation and disinformation online (name: *Verisphere — Spot misinformation on any page*). The listing
  text below is what was resubmitted. patch_ext_v017

- **0.1.6** (2026-11-03) — check mode resolves the selection against its page before locating it, so "It was first
  identified in December 2019" on the COVID-19 article finds the COVID-19 claim; with no page context, or the resolver
  unreachable, the selection is located as written. (The underliner's equivalent is server-side: app
  patch_locate_anchors.) patch_ext_check_resolve

- **0.1.5** (2026-11-03) — a claim must stand alone: the create flow sends the page title and the paragraph around the
  text to the app's `/api/claims/resolve`, which replaces pronouns and bare references ("It" → "The office printer",
  "Early cases" → "Early COVID-19 cases") and says what it changed; "Stands alone" is the first check, and creation is
  blocked while context is missing ("Say what 'It' refers to"). patch_ext_claim_resolve

- **0.1.4** (2026-11-02) — check any sentence on any site (context menu + toolbar; on-demand injection under
  activeTab, no new host permissions; the app's `/claims/locate` in `check` mode matches against the whole corpus);
  share from the panel (snapshot text, link, invitation); *Back it in the app* hand-off to the Start sheet; first-run
  page (also the options page); the app's install button is hidden by a marker on app.verisphere.co. Name →
  *Verisphere — Truth-staking for the web*. patch_ext_v014

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
- Permissions justification (0.1.4): `storage` (the on/off switch and selected wallet); `contextMenus` (the
  *Check on Verisphere* item on a text selection); `activeTab` + `scripting` (inject the overlay into the current tab
  only when the reader invokes that item or the toolbar button — never on page load, never on other tabs); host
  `*.wikipedia.org` (automatic underlining of claims on articles); host `app.verisphere.co` (the API for claims,
  scores and the relay, and a one-line marker on the app's own pages so it can hide its install button). No remote
  code; no RPC host — chain reads and signatures go through the page's injected wallet.
### Store description (0.1.7 — written to the content policy; keep it this way)

> Spot misinformation and disinformation as you read — on any site.
>
> Select a sentence that makes a claim — in a news article, a Reddit thread, a Quora answer, a forwarded post, anywhere
> — right-click, and choose Check on Verisphere. A side panel shows whether that claim is already on Verisphere and how
> it stands: a Verity Score, which is how much people have staked that the claim holds up versus how much that it
> doesn't. It is a credibility signal that is harder to fake than likes, shares or votes, because backing a claim costs
> the backer something. It is not a verdict, not a vote, and not a prediction about an event. Nothing happens on a page
> until you ask.
>
> Use it to notice when something you are reading is contested, or unsupported, before you believe it or pass it on. A
> claim nobody is willing to back deserves a second look.
>
> On English Wikipedia the extension also underlines the sentences that already have a claim on Verisphere; hover to see
> the score, click to open the panel.
>
> Verisphere is a truth-staking protocol on Avalanche C-Chain: people back or challenge factual claims with VSP tokens,
> and the stake behind each side is the score you see. From the panel you can back or challenge a claim, link evidence
> between claims, create a claim from a sentence nobody has put on Verisphere yet, and share a claim with its standing.
> Your wallet (MetaMask, Rabby, Core…) stays in control: the extension only asks it to sign; it never holds keys or
> funds. If your Verisphere wallet is a passkey, Open in the app takes you to the same claim in Verisphere.
>
> Private beta. Docs: https://app.verisphere.co/docs/viewer.html?file=guide.md · Terms: …tos.md · Privacy: …privacy.md

- Title (from the package): *Verisphere — Spot misinformation on any page*.
- Single purpose: help the reader notice misinformation and disinformation in what they are reading, by checking a
  claim against Verisphere — whether it is on the record and how much is staked for and against it — with the option
  to back or challenge it themselves.

Words that do not appear in the package or the listing, on purpose: win, lose, gain, earn, bet, odds, payout, prize,
prediction, settle, "take a side", "on the table".
