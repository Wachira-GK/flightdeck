// PKCE (RFC 7636) for the Google sign-in. The browser is sent to Google through Supabase carrying only a
// SHA-256 "challenge"; the matching secret "verifier" stays in an HttpOnly cookie on our server and is
// presented when the code comes back. A code stolen from the address bar is useless without the verifier.
// Web Crypto only (works on Cloudflare Workers and Node).

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** 64 random bytes -> 86 URL-safe characters (the RFC allows 43 to 128). */
export function newVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(64)));
}

/** code_challenge = BASE64URL(SHA-256(verifier)), method "s256". */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

const VERIFIER_SHAPE = /^[A-Za-z0-9_-]{43,128}$/;
export const isVerifier = (v: string): boolean => VERIFIER_SHAPE.test(v);
