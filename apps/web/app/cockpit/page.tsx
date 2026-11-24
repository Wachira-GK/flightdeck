import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonVariants, Card, CardEyebrow, Progress } from "@flightdeck/ui";
import { getCatalogue } from "@/lib/catalogue";
import { buildCockpit, EMPTY_PROGRESS } from "@/lib/cockpit";
import { greetingFor, hourIn, relativeTime } from "@/lib/greeting";
import { STEP_LABELS } from "@/lib/mission";
import { getOwnProfile } from "@/server/auth/gotrue";
import { authConfig, requireUser } from "@/server/auth/session";
import { getOwnProgress } from "@/server/cockpit-data";
import { accessConfig, accessSummary, isOpenFor } from "@/server/access";

export const metadata: Metadata = { title: "Cockpit" };

// Rendered per request: it depends on who is signed in (and the time-of-day greeting).
export const dynamic = "force-dynamic";

export default async function CockpitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { user, accessToken } = await requireUser("/cockpit", sp.refreshed === "1");
  const cfg = authConfig();
  // Own profile, roles and saved progress, read with the learner's own token: Row Level Security decides what is returned.
  const [profile, saved, catalogue] = await Promise.all([getOwnProfile(cfg, accessToken), getOwnProgress(cfg, accessToken), getCatalogue()]);
  const displayName = profile?.displayName || user.email.split("@")[0]!;
  const roles = profile?.roles ?? [];
  const now = new Date();
  const greeting = greetingFor(hourIn(now, profile?.timeZone ?? "Africa/Nairobi"));
  // Only missions this person can open count as "next" (ADR-011). If access cannot be read, nothing is hidden and the server still enforces.
  const access = await accessSummary(accessConfig(), user.id);
  const visible = access ? catalogue.map((t) => ({ ...t, missions: t.missions.filter((m) => isOpenFor(access, m.slug)) })) : catalogue;
  const view = buildCockpit(visible, saved ?? EMPTY_PROGRESS);
  const active = view.active;
  const nextStepHref = active ? `/missions/${active.mission.slug}?step=${active.currentStep}` : "/catalogue";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm text-fg-muted">Cockpit</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">
          {greeting}, {displayName}.
        </h1>
        <p className="mt-2 text-fg-muted">
          {active ? (view.startedAny ? "Pick up where you left off." : "Your first mission is cleared for take-off.") : "Every available mission is complete."}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-fg-muted" data-testid="signed-in-as">
            Signed in as {user.email}
          </span>
          {roles.map((r) => (
            <Badge key={r} tone={r === "learner" ? "muted" : "accent"}>
              {r}
            </Badge>
          ))}
          <Link href="/account/security" className="underline">
            Account security
          </Link>
          {roles.includes("admin") ? (
            <>
              <Link href="/admin" className="underline">
                Admin: users
              </Link>
              <Link href="/admin/missions" className="underline">
                Admin: mission access
              </Link>
            </>
          ) : null}
        </div>
        {sp.password === "changed" ? (
          <p role="status" className="mt-3 rounded-md bg-accent-subtle px-3 py-2 text-sm">
            Password changed. Use it next time you sign in.
          </p>
        ) : null}
        {saved === null ? (
          <p role="status" className="mt-3 text-sm text-fg-muted">
            We could not load your saved progress just now. Your work is not lost; refresh the page to try again.
          </p>
        ) : null}
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="active-mission-title" className="lg:col-span-2">
          <Card className="flex h-full flex-col gap-5">
            {active ? (
              <>
                <CardEyebrow>
                  {view.startedAny && active.progress > 0 ? "Active mission" : "Next mission"} · {active.trackTitle} · {active.mission.code}
                </CardEyebrow>
                <div>
                  <h2 id="active-mission-title" className="text-2xl font-semibold">
                    {active.mission.title}
                  </h2>
                  {active.mission.summary ? <p className="mt-2 text-fg-muted">{active.mission.summary}</p> : null}
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-fg-muted">Mission progress</span>
                    <span className="font-semibold">{active.progress}%</span>
                  </div>
                  <Progress value={active.progress} label={`${active.mission.title} progress`} />
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-4">
                  <Link href={nextStepHref} className={buttonVariants()}>
                    {active.progress > 0 ? "Continue" : "Start"}: {STEP_LABELS[active.currentStep]}
                  </Link>
                  {active.mission.estimatedMinutes ? <span className="text-sm text-fg-muted">About {active.mission.estimatedMinutes} min</span> : null}
                </div>
              </>
            ) : (
              <>
                <h2 id="active-mission-title" className="text-2xl font-semibold">
                  All missions complete
                </h2>
                <p className="text-fg-muted">You have finished every mission that is open today. More are on the way.</p>
                <div className="mt-auto">
                  <Link href="/catalogue" className={buttonVariants({ variant: "secondary" })}>
                    Browse the catalogue
                  </Link>
                </div>
              </>
            )}
          </Card>
        </section>

        <section aria-labelledby="activity-title">
          <Card className="h-full">
            <h2 id="activity-title" className="text-lg font-semibold">
              Recent activity
            </h2>
            {view.activity.length === 0 ? (
              <p className="mt-4 text-sm text-fg-muted">Nothing yet. Finish a Simulation or an Assessment and it will show up here.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {view.activity.map((item) => (
                  <li key={item.id} className="text-sm">
                    <p>{item.label}</p>
                    <p className="text-fg-muted">
                      <time dateTime={item.at}>{relativeTime(new Date(item.at), now)}</time>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      <section aria-labelledby="tracks-title" className="mt-12">
        <h2 id="tracks-title" className="text-xl font-semibold">
          Your tracks
        </h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {view.tracks.map((t) => {
            const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
            return (
              <li key={t.slug}>
                <Card className={t.locked ? "h-full border-dashed border-border-strong bg-surface-2" : "h-full"}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{t.title}</h3>
                      <p className="text-sm text-fg-muted">{t.subject}</p>
                    </div>
                    {t.locked ? (
                      <Badge tone="muted">
                        <LockIcon />
                        <span>Locked</span>
                      </Badge>
                    ) : (
                      <Badge tone="accent">Available</Badge>
                    )}
                  </div>
                  {t.locked ? (
                    <p className="mt-4 text-sm text-fg-muted">{t.lockedReason ?? "Coming later"}. We will open it after Excel and MathLab.</p>
                  ) : (
                    <div className="mt-4">
                      <p className="mb-2 text-sm text-fg-muted">
                        {t.done} of {t.total} missions
                      </p>
                      <Progress value={pct} label={`${t.title} track progress`} />
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {active ? (
        <section aria-labelledby="next-step-title" className="mt-12">
          <Card className="flex flex-col items-start justify-between gap-4 bg-accent-subtle sm:flex-row sm:items-center">
            <div>
              <h2 id="next-step-title" className="text-lg font-semibold">
                Next step
              </h2>
              <p className="text-fg-muted">
                {STEP_LABELS[active.currentStep]} for {active.mission.title}. You are {active.progress}% through this mission.
              </p>
            </div>
            <Link href={nextStepHref} className={buttonVariants()}>
              Resume mission
            </Link>
          </Card>
        </section>
      ) : null}
    </div>
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
