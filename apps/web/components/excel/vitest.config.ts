import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the Excel grid's pure helpers and Worker client.
 * Run: pnpm --filter @flightdeck/web exec vitest run --config components/excel/vitest.config.ts
 * (or add "components/**\/*.test.ts" to the include list in apps/web/vitest.config.ts).
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: ["components/excel/**/*.test.ts"],
    environment: "node",
  },
});
