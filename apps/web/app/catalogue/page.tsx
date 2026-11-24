import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonVariants, Card, CardEyebrow } from "@flightdeck/ui";
import { LevelSection } from "@/components/level-section";
import { MISSION_LEVELS, type CatalogueTrack } from "@/lib/catalogue";
import { getLiveCatalogue } from "@/server/catalogue-live";

export const metadata: Metadata = {
  title: "Catalogue",
  description: "Browse FlightDeck tracks and missions: Excel Masterclass and MathLab.",
};

// Rendered per request: the built-in missions plus anything an author has published (ADR-015). The database
// list is cached for 30 s inside the Worker and falls back to the built-in list if the database is unreachable.
export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  const tracks = await getLiveCatalogue();
  const missionCount = tracks.reduce((n, t) => n + t.missions.length, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm text-fg-muted">Catalogue</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Choose your next mission</h1>
        <p className="mt-2 text-fg-muted">
          {missionCount} {missionCount === 1 ? "mission" : "missions"} across{" "}
          {tracks.filter((t) => t.status === "available").length} open tracks. Every mission runs Briefing, Training,
          Simulation, Assessment and Debrief.
        </p>
      </header>

      <section aria-labelledby="tracks-title" className="mt-10">
        <h2 id="tracks-title" className="text-xl font-semibold">
          Tracks
        </h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {tracks.map((t) => (
            <li key={t.slug}>
              <TrackCard track={t} />
            </li>
          ))}
        </ul>
      </section>

      {tracks
        .filter((t) => t.status === "available")
        .map((t) => (
          <section key={t.slug} aria-labelledby={`track-${t.slug}-missions`} className="mt-12">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`track-${t.slug}-missions`} className="text-xl font-semibold">
                {t.title} missions
              </h2>
              {t.courses.map((c) => (
                <p key={c.slug} className="text-sm text-fg-muted">
                  {c.title}
                  {c.isFree ? " · Free" : ""}
                </p>
              ))}
            </div>
            {t.missions.length === 0 ? (
              <p className="mt-4 text-fg-muted">New missions for this track are being prepared.</p>
            ) : (
              MISSION_LEVELS.map((lv) => {
                const inLevel = t.missions.filter((m) => m.level === lv.id);
                if (inLevel.length === 0) return null;
                return (
                  <LevelSection
                    key={lv.id}
                    storageKey={`fd-level-${t.slug}-${lv.id}`}
                    title={lv.label}
                    blurb={lv.blurb}
                    count={inLevel.length}
                  >
              <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {inLevel.map((m) => (
                  <li key={m.slug}>
                    <Card className="flex h-full flex-col gap-4">
                      <div>
                        <CardEyebrow>
                          {m.code}
                          {m.estimatedMinutes ? ` · About ${m.estimatedMinutes} min` : ""}
                        </CardEyebrow>
                        <h4 className="mt-2 text-lg font-semibold">{m.title}</h4>
                        {m.summary ? <p className="mt-2 text-sm text-fg-muted">{m.summary}</p> : null}
                      </div>
                      <div className="mt-auto">
                        <Link href={m.href} className={buttonVariants({ variant: "secondary" })}>
                          Start mission<span className="sr-only"> {m.code} {m.title}</span>
                        </Link>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
                  </LevelSection>
                );
              })
            )}
          </section>
        ))}
    </div>
  );
}

function TrackCard({ track: t }: { track: CatalogueTrack }) {
  const locked = t.status === "locked";
  return (
    <Card className={locked ? "h-full border-dashed border-border-strong bg-surface-2" : "h-full"}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{t.title}</h3>
          <p className="text-sm text-fg-muted">{t.subject}</p>
        </div>
        {locked ? (
          <Badge tone="muted">
            <LockIcon />
            <span>{t.lockedReason ?? "Coming later"}</span>
          </Badge>
        ) : (
          <Badge tone="accent">Available</Badge>
        )}
      </div>
      <p className="mt-4 text-sm text-fg-muted">{t.description}</p>
      {locked ? null : (
        <p className="mt-4 text-sm">
          <a href={`#track-${t.slug}-missions`} className="font-medium text-accent underline-offset-4 hover:underline">
            {t.missions.length} {t.missions.length === 1 ? "mission" : "missions"}
            <span className="sr-only"> in {t.title}</span>
          </a>
        </p>
      )}
    </Card>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
