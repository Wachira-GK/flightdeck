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
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(isProd
            ? [
                { key: "Content-Security-Policy", value: CSP },
                { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;

