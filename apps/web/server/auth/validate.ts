// Input rules for the auth forms. Pure functions, no I/O. The browser may also check these for a quicker
// message, but the server always re-checks (the form is untrusted input).

export const PASSWORD_MIN = 10;
/** bcrypt, which Supabase uses, ignores everything after 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normaliseEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function isEmail(email: string): boolean {
  return email.length > 0 && email.length <= EMAIL_MAX && EMAIL_RE.test(email);
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (byteLength(password) > PASSWORD_MAX_BYTES) return `Use at most ${PASSWORD_MAX_BYTES} bytes (about 70 characters).`;
  if (/^(.)\1+$/.test(password)) return "Choose a password that is not one repeated character.";
  return null;
}

/**
 * Where to go after signing in. Only same-site paths are allowed: it must start with a single "/" and may
 * not be a protocol-relative ("//host") or backslash trick. Anything else falls back to the Cockpit.
 */
export function safeNext(raw: unknown, fallback = "/cockpit"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return fallback;
    return `${u.pathname}${u.search}`;
  } catch {
    return fallback;
  }
}
