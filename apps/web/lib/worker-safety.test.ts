import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Cloudflare Workers have no filesystem, and OpenNext may re-render "static" pages on the Worker.
// Runtime code (everything except tests and build scripts) must not import node:fs.
const ROOTS = ["app", "components", "lib", "server"];
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("Worker safety", () => {
  it("no runtime module imports node:fs", () => {
    const offenders = ROOTS.flatMap(walk)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /from\s+["'](node:)?fs(\/promises)?["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
