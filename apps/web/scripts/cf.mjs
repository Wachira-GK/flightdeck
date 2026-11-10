#!/usr/bin/env node
/**
 * Runs the OpenNext Cloudflare CLI (`opennextjs-cloudflare <args>`), preloading the Windows
 * symlink shim so local builds work without admin rights. Identical to the plain CLI elsewhere.
 *   node scripts/cf.mjs build
 *   node scripts/cf.mjs preview --ip 127.0.0.1 --port 8787
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// pnpm links the package into apps/web/node_modules; its exports map hides package.json.
const appDir = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(appDir, "node_modules", "@opennextjs", "cloudflare", "dist", "cli", "index.js");
const shim = fileURLToPath(new URL("./win-symlink-shim.cjs", import.meta.url));

const result = spawnSync(process.execPath, ["--require", shim, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { NEXT_TELEMETRY_DISABLED: "1", ...process.env },
});
process.exit(result.status ?? 1);
