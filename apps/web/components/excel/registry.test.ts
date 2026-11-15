import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(__dirname, "..", "..");

describe("generated Excel registry", () => {
  it("is up to date with content/excel (run: pnpm --filter @flightdeck/web registry:excel)", async () => {
    const mod = (await import(pathToFileURL(path.join(appDir, "scripts", "gen-excel-registry.mjs")).href)) as {
      generate: () => { learner: string; server: string; learnerPath: string; serverPath: string };
    };
    const g = mod.generate();
    const norm = (s: string) => s.replace(/\r\n/g, "\n");
    expect(norm(fs.readFileSync(g.learnerPath, "utf8"))).toBe(norm(g.learner));
    expect(norm(fs.readFileSync(g.serverPath, "utf8"))).toBe(norm(g.server));
  });

  it("keeps answer keys out of the learner-safe table", () => {
    const learner = fs.readFileSync(path.join(appDir, "components", "excel", "registry.generated.ts"), "utf8");
    expect(learner).not.toMatch(/^import .*\.keys?\.json/m);
  });
});
