/**
 * Catalogue data source (FD-C01).
 *
 * Today: `contentCatalogueSource` reads the same files the database seed is generated from
 * (packages/database/seeds/catalogue.config.json + content/<dir>/missions/<slug>.json) with `fs`,
 * at BUILD time only: /catalogue is a static page, so nothing here runs per request on the Worker.
 * Only learner-safe mission files are read; *.key.json / *.keys.json are never opened.
 *
 * Later: add a `supabaseCatalogueSource` implementing the same `CatalogueSource` interface with
 * anon-key queries (RLS returns only published rows), map rows to the same types, and switch
 * `catalogueSource` below. Draft tracks are invisible to anon in the database, so that source
 * shows "coming later" tracks from config. See docs/data/CATALOGUE-SEEDING.md.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type CatalogueMission = {
  slug: string;
  /** Display code, e.g. "EX-101". */
  code: string;
  title: string;
  summary: string | null;
  estimatedMinutes: number | null;
  /** 1-based order within its course version. */
  position: number;
  courseSlug: string;
  href: `/missions/${string}`;
};

export type CatalogueCourse = { slug: string; title: string; summary: string; isFree: boolean; version: number };

export type CatalogueTrack = {
  slug: string;
  title: string;
  subject: string;
  description: string;
  /** "available" = published track; "locked" = draft, shown as coming later with no missions. */
  status: "available" | "locked";
  lockedReason?: string;
  courses: CatalogueCourse[];
  missions: CatalogueMission[];
};

export interface CatalogueSource {
  /** Tracks in display order, each with its published course(s) and missions in order. */
  listTracks(): Promise<CatalogueTrack[]>;
}

type ConfigTrack = {
  slug: string;
  title: string;
  subject: string;
  description: string;
  contentDir: string | null;
  contentTrackIds: string[];
  status: "published" | "draft";
  sortOrder: number;
  lockedReason?: string;
};
type ConfigCourse = { slug: string; track: string; title: string; summary: string; isFree: boolean; version: number };
type CatalogueConfig = { tracks: ConfigTrack[]; courses: ConfigCourse[] };

function findRepoRoot(start = process.cwd()): string {
  let dir = start;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("catalogue: repository root (pnpm-workspace.yaml) not found");
    dir = parent;
  }
  return dir;
}

const isKeyFile = (f: string) => f.endsWith(".key.json") || f.endsWith(".keys.json");

function readMissions(root: string, track: ConfigTrack, course: ConfigCourse | undefined): CatalogueMission[] {
  if (!track.contentDir || !course || track.status !== "published") return [];
  const dir = join(root, "content", track.contentDir, "missions");
  if (!existsSync(dir)) return [];
  const missions: Omit<CatalogueMission, "position">[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !isKeyFile(f)).sort()) {
    try {
      const m = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      const slug = typeof m.slug === "string" ? m.slug : "";
      if (`${slug}.json` !== file || typeof m.code !== "string" || typeof m.title !== "string") continue;
      if (typeof m.trackId === "string" && !track.contentTrackIds.includes(m.trackId)) continue;
      missions.push({
        slug,
        code: m.code,
        title: m.title,
        summary: typeof m.summary === "string" ? m.summary : null,
        estimatedMinutes: typeof m.estimatedMinutes === "number" ? m.estimatedMinutes : null,
        courseSlug: course.slug,
        href: `/missions/${slug}`,
      });
    } catch {
      // A half-written or invalid content file is left out; the seed generator is the strict gate.
    }
  }
  missions.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }) || a.slug.localeCompare(b.slug));
  return missions.map((m, i) => ({ ...m, position: i + 1 }));
}

export const contentCatalogueSource: CatalogueSource = {
  async listTracks() {
    const root = findRepoRoot();
    const config = JSON.parse(
      readFileSync(join(root, "packages", "database", "seeds", "catalogue.config.json"), "utf8"),
    ) as CatalogueConfig;
    return [...config.tracks]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t): CatalogueTrack => {
        const courses = t.status === "published" ? config.courses.filter((c) => c.track === t.slug) : [];
        return {
          slug: t.slug,
          title: t.title,
          subject: t.subject,
          description: t.description,
          status: t.status === "published" ? "available" : "locked",
          ...(t.status === "published" ? {} : { lockedReason: t.lockedReason ?? "Coming later" }),
          courses: courses.map(({ slug, title, summary, isFree, version }) => ({ slug, title, summary, isFree, version })),
          missions: courses.flatMap((c) => readMissions(root, t, c)),
        };
      });
  },
};

/** The active source. Swap for a Supabase-backed source once the project exists (FD-C01 follow-up). */
export const catalogueSource: CatalogueSource = contentCatalogueSource;

export function getCatalogue(): Promise<CatalogueTrack[]> {
  return catalogueSource.listTracks();
}
