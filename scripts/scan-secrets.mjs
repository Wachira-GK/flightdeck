// Secret + client-bundle scan (G1 step 9). Fails the build if a credential pattern is found in
// tracked files, or if any server-only secret marker reaches a browser bundle.
// Usage: node scripts/scan-secrets.mjs   (runs first in `pnpm check`)
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  ['JWT / Supabase key', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{20,}/],
  ['Paystack secret key', /sk_(live|test)_[A-Za-z0-9]{20,}/],
  ['Resend API key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['Cloudflare API token', /\b(CF|CLOUDFLARE)_API_TOKEN\s*=\s*[A-Za-z0-9_-]{30,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Assigned service role key', /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S{20,}/],
];
const SKIP = /(^|\/)(pnpm-lock\.yaml|scan-secrets\.mjs)$|\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip)$/i;

const findings = [];
const tracked = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const file of tracked) {
  if (SKIP.test(file) || !existsSync(file) || statSync(file).size > 2_000_000) continue;
  const text = readFileSync(file, 'utf8');
  for (const [name, re] of PATTERNS) if (re.test(text)) findings.push(`${file}: ${name}`);
}

// Client bundles must never contain server-only secret names or values.
const CLIENT_DIRS = ['apps/web/.next/static', 'apps/web/.open-next/assets'];
const BUNDLE_MARKERS = [/SUPABASE_SERVICE_ROLE_KEY/, /service_role/, /PAYSTACK_SECRET/, /RESEND_API_KEY/];
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
let bundleFiles = 0;
for (const dir of CLIENT_DIRS.filter(existsSync)) {
  for (const file of walk(dir).filter((f) => /\.(js|mjs|html|json|map)$/.test(f))) {
    bundleFiles++;
    const text = readFileSync(file, 'utf8');
    for (const re of [...BUNDLE_MARKERS, ...PATTERNS.map(([, r]) => r)]) {
      if (re.test(text)) findings.push(`${file}: client bundle contains ${re}`);
    }
  }
}

if (findings.length) {
  console.error(`secret scan FAILED (${findings.length}):\n  ${findings.join('\n  ')}`);
  process.exit(1);
}
console.log(`secret scan passed: ${tracked.length} files, ${bundleFiles} client bundle files`);
