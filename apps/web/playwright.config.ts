import { defineConfig, devices } from "@playwright/test";

// E2E + axe accessibility smoke. Kept out of `pnpm test` so a flaky browser never breaks unit CI.
// Uses an installed browser channel (no Playwright browser download, no admin):
//   Windows default: Microsoft Edge; elsewhere: Google Chrome. Override with PW_CHANNEL.
const channel = process.env.PW_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chrome");
const port = Number(process.env.PW_PORT ?? 3100);
const baseURL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "light", use: { ...devices["Desktop Chrome"], channel, colorScheme: "light" } },
    { name: "dark", use: { ...devices["Desktop Chrome"], channel, colorScheme: "dark" } },
  ],
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        // Requires a prior `pnpm build`.
        command: `next start --hostname 127.0.0.1 --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
