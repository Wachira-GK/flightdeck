// Imports the built-in mission files into the content workspace as revision 1, status published (ADR-015, stage 2a-ii).
// Safe to re-run: a mission that already has revision 1 is skipped. It only INSERTS; it never updates or deletes.
// The live catalogue rows already exist from the seed, so rows are marked live_synced = true.
//
// Run (PowerShell, repo root):  $env:FD_PG_DIR='C:\Temp\fdpg'; $env:FD_DB_CA='C:\Temp\fdpg\ca.crt'; node tools/import-content.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pg;
try {
  pg = require("pg");
} catch {
  if (!process.env.FD_PG_DIR) throw new Error("Set FD_PG_DIR to a folder that contains node_modules\\pg.");
  pg = require(path.join(process.env.FD_PG_DIR, "node_modules", "pg"));
}
const dry = process.argv.includes("--dry");
const root = process.cwd();
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const exists = fs.existsSync;

const items = [];
for (const [dir, track] of [["excel", "excel"], ["math", "math"]]) {
  const mdir = path.join(root, "content", dir, "missions");
  if (!exists(mdir)) continue;
  for (const f of fs.readdirSync(mdir).filter((x) => x.endsWith(".json") && !x.endsWith(".keys.json")).sort()) {
    const mission = readJson(path.join(mdir, f));
    const keysFile = path.join(mdir, f.replace(/\.json$/, ".keys.json"));
    const keys = exists(keysFile) ? readJson(keysFile) : {};
    let exercise = null;
    let exerciseKey = null;
    if (track === "excel" && mission.exerciseId) {
      const exDir = path.join(root, "content", "excel", "exercises");
      exercise = readJson(path.join(exDir, `${mission.exerciseId}.json`));
      const kf = path.join(exDir, `${mission.exerciseId}.key.json`);
      exerciseKey = exists(kf) ? readJson(kf) : null;
    }
    items.push({ slug: mission.slug, track, code: mission.code, title: mission.title, level: mission.level ?? "beginner", mission, exercise, keys, exerciseKey });
  }
}
console.log(`${items.length} mission files found (${items.filter((i) => i.track === "excel").length} excel, ${items.filter((i) => i.track === "math").length} math)`);
if (dry) process.exit(0);

const env = fs.readFileSync("apps/web/.env.local", "utf8");
const url = new URL(env.match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^"|"$/g, ""));
if (!process.env.FD_DB_CA) throw new Error("Set FD_DB_CA to the Supabase CA file (the connection is always verified).");
const c = new pg.Client({
  host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password), database: url.pathname.slice(1) || "postgres",
  ssl: { ca: fs.readFileSync(process.env.FD_DB_CA, "utf8"), rejectUnauthorized: true },
});
await c.connect();
try {
  await c.query("begin");
  const owner = (await c.query("select user_id from app_private.platform_owner limit 1")).rows[0]?.user_id;
  if (!owner) throw new Error("no platform owner: cannot record who published the import");
  let added = 0;
  for (const i of items) {
    const r = await c.query(
      `insert into app_private.content_items (slug, revision, status, track, code, title, level, mission, exercise, keys, exercise_key, reviewer_id, change_note, published_at, live_synced)
       values ($1, 1, 'published', $2, $3, $4, $5::public.course_level, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, 'Imported from the built-in mission files', now(), true)
       on conflict (slug, revision) do nothing`,
      [i.slug, i.track, i.code, i.title, i.level, JSON.stringify(i.mission), i.exercise ? JSON.stringify(i.exercise) : null, JSON.stringify(i.keys), i.exerciseKey ? JSON.stringify(i.exerciseKey) : null, owner],
    );
    added += r.rowCount;
  }
  await c.query(
    "insert into app_private.audit_log (actor_id, action, entity, entity_id, detail) values ($1, 'content_import', 'content', 'all', $2::jsonb)",
    [owner, JSON.stringify({ added, total: items.length })],
  );
  await c.query("commit");
  console.log(`imported ${added} new, ${items.length - added} already present`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.log("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
