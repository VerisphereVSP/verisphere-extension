// Wrapper so the extension takes a friendly `--env <name>` flag (dev|production).
// Vite's native selector is `--mode`, so we translate: `--env dev` →
// `--mode dev`, which drives which `.env.<name>` file Vite loads.
//
// Note: Vite forbids the mode name "local" (it clashes with the .local env-file
// convention), so we alias local → dev. Canonical envs: dev, production.
//
//   node scripts/run.mjs dev                    → vite --mode dev
//   node scripts/run.mjs build                  → vite build --mode dev
//   node scripts/run.mjs build --env production → vite build --mode production
import { spawn } from "node:child_process";

const [, , cmd, ...rest] = process.argv;
const i = rest.indexOf("--env");
let env = i !== -1 && rest[i + 1] ? rest[i + 1] : "dev";
if (i !== -1) rest.splice(i, 2);
if (env === "local") env = "dev";

const args = cmd === "build" ? ["build", "--mode", env, ...rest] : ["--mode", env, ...rest];
const child = spawn("npx", ["vite", ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
