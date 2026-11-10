import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config for the G1 spike: no incremental cache (R2/KV) yet, because every prototype
// route is either static or force-dynamic. Add an R2 incremental cache before using ISR.
export default defineCloudflareConfig({});
