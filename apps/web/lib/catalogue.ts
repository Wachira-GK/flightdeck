/**
 * Catalogue data source (FD-C01).
 *
 * Today: `contentCatalogueSource` reads the same files the database seed is generated from
 * (packages/database/seeds/catalogue.config.json + content/<dir>/missions/<slug>.json) via static JSON
 * imports bundled at build time. No `fs`: Cloudflare Workers have no filesystem, and OpenNext may
 * re-render "static" pages on the Worker. Only learner-safe mission files are imported here; never
 * add a *.key.json / *.keys.json import. When a mission file is added, register it in MISSION_FILES.
 *
 * Later: add a `supabaseCatalogueSource` implementing the same `CatalogueSource` interface with
 * anon-key queries (RLS returns only published rows), map rows to the same types, and switch
 * `catalogueSource` below. Draft tracks are invisible to anon in the database, so that source
 * shows "coming later" tracks from config. See docs/data/CATALOGUE-SEEDING.md.
 */
import config from "../../../packages/database/seeds/catalogue.config.json";
import excelIf102 from "../../../content/excel/missions/excel-if-102.json";
import excelLookup103 from "../../../content/excel/missions/excel-lookup-103.json";
import excelSum101 from "../../../content/excel/missions/excel-sum-101.json";
import descriptiveStats101 from "../../../content/math/missions/descriptive-stats-101.json";

/** Learner-safe mission files per content directory (keys are never imported). */
const MISSION_FILES: Record<string, unknown[]> = {
  excel: [excelSum101, excelIf102, excelLookup103],
  math: [descriptiveStats101],
};

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

function readMissions(track: ConfigTrack, course: ConfigCourse | undefined): CatalogueMission[] {
  if (!track.contentDir || !course || track.status !== "published") return [];
  const missions: Omit<CatalogueMission, "position">[] = [];
  for (const raw of MISSION_FILES[track.contentDir] ?? []) {
    try {
      const m = raw as Record<string, unknown>;
      const slug = typeof m.slug === "string" ? m.slug : "";
      if (!slug || typeof m.code !== "string" || typeof m.title !== "string") continue;
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
    const cfg = config as unknown as CatalogueConfig;
    return [...cfg.tracks]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t): CatalogueTrack => {
        const courses = t.status === "published" ? cfg.courses.filter((c) => c.track === t.slug) : [];
        return {
          slug: t.slug,
          title: t.title,
          subject: t.subject,
          description: t.description,
          status: t.status === "published" ? "available" : "locked",
          ...(t.status === "published" ? {} : { lockedReason: t.lockedReason ?? "Coming later" }),
          courses: courses.map(({ slug, title, summary, isFree, version }) => ({ slug, title, summary, isFree, version })),
          missions: courses.flatMap((c) => readMissions(t, c)),
        };
      });
  },
};

/** The active source. Swap for a Supabase-backed source once the project exists (FD-C01 follow-up). */
export const catalogueSource: CatalogueSource = contentCatalogueSource;

export function getCatalogue(): Promise<CatalogueTrack[]> {
  return catalogueSource.listTracks();
}
