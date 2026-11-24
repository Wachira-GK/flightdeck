// FlightDeck data backup (ADR-014). Exports every table in the `public` and `app_private` schemas, plus a safe subset of
// auth.users, to one JSON file per table in a NEW dated folder. It only READS the database and never deletes or overwrites
// anything (it refuses to write into a folder that already exists).
//
// Why: the Supabase free plan has no downloadable backups. This is the safety net until the project moves to a paid plan.
//
// Run (PowerShell, from the repo root):
//   node tools/backup-data.mjs [--out C:\WebDev\Backups] [--env apps\web\.env.local]
// Needs: SUPABASE_DB_URL in the env file (the direct Postgres connection string), the `pg` package, and the Supabase CA
// certificate. If `pg` is not installed in the repo, point FD_PG_DIR at a folder that has node_modules\pg, and FD_DB_CA at
// the CA file (prod-ca-2021.crt from the Supabase dashboard: Database > Settings > SSL Configuration).
//
// The backup contains PERSONAL DATA (names, emails, learning records). Keep it somewhere private and never commit it.
// Passwords are NOT included (Supabase keeps only hashes and we do not export them): after a restore, learners use "Forgot password".
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pg;
try {
  pg = require("pg");
} catch {
  if (!process.env.FD_PG_DIR) throw new Error("The pg package was not found. Set FD_PG_DIR to a folder that contains node_modules\\pg.");
  pg = require(path.join(process.env.FD_PG_DIR, "node_modules", "pg"));
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const envFile = arg("env", "apps/web/.env.local");
const outRoot = arg("out", "C:\\WebDev\\Backups");
const caFile = process.env.FD_DB_CA;

const env = fs.readFileSync(envFile, "utf8");
const m = env.match(/^SUPABASE_DB_URL=(.*)$/m);
if (!m) throw new Error(`SUPABASE_DB_URL is not set in ${envFile}`);
const url = new URL(m[1].trim().replace(/^"|"$/g, ""));
if (!caFile) throw new Error("Set FD_DB_CA to the path of the Supabase CA certificate (the connection is always verified).");

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const dir = path.join(outRoot, `flightdeck-${stamp}`);
if (fs.existsSync(dir)) throw new Error(`${dir} already exists; not overwriting. Wait a minute and run again.`);
fs.mkdirSync(dir, { recursive: true });

const c = new pg.Client({
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1) || "postgres",
  ssl: { ca: fs.readFileSync(caFile, "utf8"), rejectUnauthorized: true },
});
await c.connect();
await c.query("begin transaction isolation level repeatable read read only"); // one consistent snapshot, cannot write

const tables = (
  await c.query(
    `select table_schema as s, table_name as t from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema in ('public', 'app_private') order by 1, 2`,
  )
).rows.map((r) => ({ name: `${r.s}.${r.t}`, sql: `select to_jsonb(x) as row from ${JSON.stringify(r.s)}.${JSON.stringify(r.t)} x` }));
// Users: identity and sign-up facts only. No password hashes, tokens or MFA secrets.
tables.push({
  name: "auth.users (safe columns)",
  sql: `select jsonb_build_object('id', id, 'email', email, 'created_at', created_at, 'email_confirmed_at', email_confirmed_at, 'last_sign_in_at', last_sign_in_at, 'raw_user_meta_data', raw_user_meta_data, 'raw_app_meta_data', raw_app_meta_data) as row from auth.users order by created_at`,
});

const manifest = { createdAt: new Date().toISOString(), tables: {}, note: "Passwords, tokens and MFA secrets are not included." };
for (const t of tables) {
  const rows = (await c.query(t.sql)).rows.map((r) => r.row);
  const file = `${t.name.replace(/[^a-z0-9_.]+/gi, "_")}.json`;
  fs.writeFileSync(path.join(dir, file), JSON.stringify(rows, null, 1));
  manifest.tables[t.name] = { file, rows: rows.length };
  console.log(`${t.name}: ${rows.length} rows`);
}
await c.query("rollback");
await c.end();

fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(dir, "README.txt"),
  [
    "FlightDeck data backup. Contains personal data: keep private, do not commit or email.",
    "",
    "Restore outline (do this on a NEW Supabase project, never over a working one):",
    "1. Apply every migration in packages/database/supabase/migrations in order.",
    "2. Create the users again (Supabase Auth admin API, same ids from auth.users.json), then insert rows from each table's JSON",
    "   with insert ... select * from jsonb_populate_recordset(null::<table>, '<json>') in dependency order (users, profiles, roles, content, enrolments, attempts, logs).",
    "3. Learners reset their password with Forgot password (hashes are not in the backup).",
    "",
    "Check manifest.json: row counts per table at the time of the backup.",
  ].join("\n"),
);
console.log(`\nBackup written to ${dir}`);
