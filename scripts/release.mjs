// release.mjs — gate and package the Chrome Web Store build. patch_ext_release
//
//   npm run release   →  tsc, vite build --mode production, then this script:
//     1. dist/manifest.json must declare only production hosts (no localhost, no test host, no *.example);
//     2. no built file may mention a dev host or the *.example placeholder;
//     3. the manifest's api origin must match .env.production's VITE_APP_API_BASE;
//     4. zip dist/ → release/verisphere-extension-<version>.zip (what the dashboard takes).
//   Exit non-zero on any failure, with the reason — do not upload a build this script rejected.
//   RELEASE_NO_ZIP=1 runs the checks only (the dev gate runs it in a container without `zip`).
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const dist = "dist";
const fail = (m) => { console.error(`RELEASE FAIL: ${m}`); process.exit(1); };
if (!existsSync(join(dist, "manifest.json"))) fail("dist/manifest.json missing — run the production build first");

const envText = readFileSync(".env.production", "utf8");
const apiBase = (envText.match(/^VITE_APP_API_BASE=(\S+)/m) ?? [])[1];
if (!apiBase) fail(".env.production has no VITE_APP_API_BASE");
const apiOrigin = new URL(apiBase).origin;

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const forbidden = [/localhost/, /test\.verisphere\.co/, /\.example\b/, /avax-test/, /127\.0\.0\.1/];
for (const h of manifest.host_permissions ?? []) {
  if (forbidden.some((re) => re.test(h))) fail(`host_permissions carries a dev host: ${h}`);
}
if (!(manifest.host_permissions ?? []).includes(`${apiOrigin}/api/*`)) fail(`host_permissions lacks ${apiOrigin}/api/* (got ${JSON.stringify(manifest.host_permissions)})`);
if (manifest.key) fail("manifest.json contains a 'key' field — remove it for the store");

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk(dist)) {
  if (!/\.(js|json|html|css)$/.test(f)) continue;
  const t = readFileSync(f, "utf8");
  for (const re of forbidden) if (re.test(t)) fail(`${relative(".", f)} mentions a dev host (${re})`);
  if (/\bmock\b.*VITE_API_MODE|VITE_API_MODE.*\bmock\b/.test(t)) fail(`${relative(".", f)} may be a mock-mode build`);
}
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`manifest version '${version}' is not x.y.z`);

if (process.env.RELEASE_NO_ZIP) { console.log(`RELEASE CHECKS OK (no zip): v${version}, api ${apiOrigin}, hosts ${JSON.stringify(manifest.host_permissions)}`); process.exit(0); }
mkdirSync("release", { recursive: true });
const out = join("release", `verisphere-extension-${version}.zip`);
if (existsSync(out)) rmSync(out);
try { execFileSync("zip", ["-qr", join("..", out), "."], { cwd: dist, stdio: "inherit" }); }
catch { fail("'zip' not found — install it (apt/brew install zip) or zip the CONTENTS of dist/ by hand (manifest.json at the zip root)"); }
console.log(`RELEASE OK: ${out} (v${version}, api ${apiOrigin}, hosts ${JSON.stringify(manifest.host_permissions)})`);
