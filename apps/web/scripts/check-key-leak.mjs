#!/usr/bin/env node
// Key-leak check: fails if any Excel answer-key data reached the client bundle (.next/static).
// Run after `pnpm --filter @flightdeck/web build`:
//   node apps/web/scripts/check-key-leak.mjs            (from the repo root)
//   node scripts/check-key-leak.mjs                     (from apps/web)
// Exports runKeyLeakCheck() so scripts/scan-secrets.mjs can call it. Exit code 1 on a leak.
//
// Markers come from every server-only key file:
//   content/excel/exercises/*.key.json  -> hidden-test labels and ids, expected-check labels
//   content/excel/missions/*.keys.json  -> rationale texts
// A positive control (an engine message that MUST be in the bundle) proves the scan reads the files.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(WEB, "..", "..");
const STATIC_DIR = join(WEB, ".next", "static");
const CONTROL = "is not available in this simulator";

function listFiles(dir, filter) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, filter));
    else if (filter(name)) out.push(p);
  }
  return out;
}

/** Distinctive strings from each key file: [{ file, marker }]. */
export function collectMarkers() {
  const markers = [];
  const add = (file, s) => {
    if (typeof s === "string" && s.trim().length >= 8) markers.push({ file: relative(REPO, file), marker: s });
  };
  for (const file of listFiles(join(REPO, "content", "excel", "exercises"), (n) => n.endsWith(".key.json"))) {
    const key = JSON.parse(readFileSync(file, "utf8"));
    for (const t of key.hiddenTests ?? []) {
      add(file, t.label);
      add(file, `"${t.id}"`);
    }
    for (const e of key.expected ?? []) if ((e.label ?? "").length >= 20) add(file, e.label);
  }
  for (const file of listFiles(join(REPO, "content", "excel", "missions"), (n) => n.endsWith(".keys.json"))) {
    const keys = JSON.parse(readFileSync(file, "utf8"));
    for (const item of keys.items ?? []) add(file, item.rationale);
  }
  return markers;
}

/** Returns { ok, leaks, scanned, markers, problems }. */
export function runKeyLeakCheck() {
  const problems = [];
  if (!existsSync(STATIC_DIR)) {
    return { ok: false, leaks: [], scanned: 0, markers: 0, problems: [`${relative(REPO, STATIC_DIR)} not found: run the web build first`] };
  }
  const files = listFiles(STATIC_DIR, (n) => /\.(js|mjs|json|html|txt|map)$/.test(n));
  const markers = collectMarkers();
  if (markers.length === 0) problems.push("no key markers found (content/excel key files missing?)");
  // JSON escaping in bundles may turn " into \" ; search for both forms.
  const variants = (m) => [m, m.replace(/"/g, '\\"'), JSON.stringify(m).slice(1, -1)];
  const leaks = [];
  let controlSeen = false;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (text.includes(CONTROL)) controlSeen = true;
    for (const { file, marker } of markers) {
      if (variants(marker).some((v) => text.includes(v))) leaks.push({ bundle: relative(REPO, f), keyFile: file, marker });
    }
  }
  if (!controlSeen) problems.push(`positive control "${CONTROL}" not found in ${files.length} bundle files: is the Excel grid still bundled?`);
  return { ok: leaks.length === 0 && problems.length === 0, leaks, scanned: files.length, markers: markers.length, problems };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === (await import("node:path")).resolve(process.argv[1]);
if (isMain) {
  const r = runKeyLeakCheck();
  for (const p of r.problems) console.error(`check-key-leak: ${p}`);
  for (const l of r.leaks) console.error(`check-key-leak: LEAK from ${l.keyFile} in ${l.bundle}: ${JSON.stringify(l.marker)}`);
  if (r.ok) console.log(`check-key-leak: OK (${r.markers} markers, ${r.scanned} files in .next/static)`);
  process.exit(r.ok ? 0 : 1);
}
