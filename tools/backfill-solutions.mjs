// Adds the reference solution to the sheet answer key of imported built-in missions, so authors can reopen and edit them
// (ADR-015, stage 2c). ADDITIVE and idempotent: it only sets exercise_key.authoring.solution on published revision-1 rows
// that do not have it yet; nothing else in the row changes and nothing is deleted. The solution is server-only, like the key.
//
// Run (PowerShell, repo root):  $env:FD_PG_DIR='C:\Temp\fdpg'; $env:FD_DB_CA='C:\Temp\fdpg\ca.crt'; node tools/backfill-solutions.mjs [--dry]
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
const dir = path.join(process.cwd(), "content", "excel", "solutions");
const solutions = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".solution.json"))) {
  solutions.set(f.replace(/\.solution\.json$/, ""), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).cells);
}
console.log(`${solutions.size} solution files found`);
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
  let updated = 0;
  let missing = 0;
  const rows = (await c.query("select id, slug, exercise->>'id' as exid from app_private.content_items where track = 'excel' and exercise_key is not null and exercise_key->'authoring' is null")).rows;
  for (const r of rows) {
    const sol = solutions.get(r.exid);
    if (!sol) {
      missing += 1;
      continue;
    }
    const res = await c.query(
      "update app_private.content_items set exercise_key = exercise_key || jsonb_build_object('authoring', jsonb_build_object('solution', $2::jsonb)) where id = $1 and exercise_key->'authoring' is null",
      [r.id, JSON.stringify(sol)],
    );
    updated += res.rowCount;
  }
  if (owner) {
    await c.query("insert into app_private.audit_log (actor_id, action, entity, entity_id, detail) values ($1, 'content_backfill_solutions', 'content', 'all', $2::jsonb)", [owner, JSON.stringify({ updated, missing })]);
  }
  await c.query("commit");
  console.log(`updated ${updated} rows, ${missing} without a solution file`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.log("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
