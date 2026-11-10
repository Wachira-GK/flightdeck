import type { NextConfig } from "next";

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
        ],
      },
    ];
  },
};

export default nextConfig;

