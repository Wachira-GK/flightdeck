import type { NextConfig } from "next";

// Content-Security-Policy (ASVS V14.4). Production only: Turbopack dev needs eval for HMR.
// script-src keeps 'unsafe-inline' because Next's App Router injects inline bootstrap scripts;
// upgrade path is nonce-based CSP via proxy.ts (forces dynamic rendering = more Worker CPU) or
// hash-based SRI. Recorded in docs/security/SECURITY-HEADERS.md.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");
const CSP_SIMBAY = CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'").replace("img-src 'self' data:", "img-src 'self' data: blob:");
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@flightdeck/ui"],
  images: {
    // G1 prototype ships no raster images. On Cloudflare, Next image optimisation needs an
    // IMAGES binding (see docs/architecture/CLOUDFLARE-SPIKE.md); keep it off until decided.
    unoptimized: true,
  },
  // sharp is only used by Next's built-in image optimiser, which is disabled above. Excluding it
  // from the server trace keeps native .node binaries out of the Cloudflare Worker bundle
  // (OpenNext/esbuild cannot bundle them). Revisit together with the images decision in ADR-003.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/sharp/**",
      "node_modules/@img/**",
      "../../node_modules/.pnpm/sharp@*/**",
      "../../node_modules/.pnpm/@img+*/**",
    ],
  },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    const hsts = { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" };
    return [
      {
        // Everything except Sim Bay (/simbay): the standard policy.
        source: "/((?!simbay).*)",
        headers: [...common, ...(isProd ? [{ key: "Content-Security-Policy", value: CSP }, hsts] : [])],
      },
      {
        // Sim Bay runs its spreadsheet engine as WebAssembly, so it alone also allows 'wasm-unsafe-eval'
        // (WebAssembly only, not eval of text). Everything else in the policy is unchanged. See ADR-017.
        source: "/simbay/:path*",
        headers: [...common, ...(isProd ? [{ key: "Content-Security-Policy", value: CSP_SIMBAY }, hsts] : [])],
      },
    ];
  },};

export default nextConfig;

