import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonVariants, Card, CardEyebrow, Progress } from "@flightdeck/ui";
import { greetingFor, hourIn, relativeTime } from "@/lib/greeting";
import { missionProgress, STEP_LABELS } from "@/lib/mission";
import { getTrack, missions, recentActivity, tracks } from "@/lib/mock-data";
import { signOutAction } from "@/app/auth/actions";
import { getOwnProfile } from "@/server/auth/gotrue";
import { authConfig, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Cockpit" };

// Rendered per request: it depends on who is signed in (and the time-of-day greeting).
export const dynamic = "force-dynamic";

export default async function CockpitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { user, accessToken } = await requireUser("/cockpit", sp.refreshed === "1");
  // Own profile + roles, read with the learner's own token: Row Level Security decides what is returned.
  const profile = await getOwnProfile(authConfig(), accessToken);
  const displayName = profile?.displayName || user.email.split("@")[0]!;
  const roles = profile?.roles ?? [];
  const now = new Date();
  const greeting = greetingFor(hourIn(now, profile?.timeZone ?? "Africa/Nairobi"));
  const mission = missions[0]!;
  const track = getTrack(mission.trackId);
  const progress = missionProgress(mission.completedSteps);
  const nextStepHref = `/missions/${mission.slug}?step=${mission.currentStep}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm text-fg-muted">Cockpit</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">
          {greeting}, {displayName}.
        </h1>
        <p className="mt-2 text-fg-muted">Your next mission is cleared for take-off.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-fg-muted" data-testid="signed-in-as">
            Signed in as {user.email}
          </span>
          {roles.map((r) => (
            <Badge key={r} tone={r === "learner" ? "muted" : "accent"}>
              {r}
            </Badge>
          ))}
          <form action={signOutAction}>
            <button
              type="submit"
              className="min-h-11 rounded-md border border-border-strong px-3 font-medium text-fg hover:bg-surface-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="active-mission-title" className="lg:col-span-2">
          <Card className="flex h-full flex-col gap-5">
            <CardEyebrow>
              Active mission · {track?.name} · {mission.code}
            </CardEyebrow>
            <div>
              <h2 id="active-mission-title" className="text-2xl font-semibold">
                {mission.title}
              </h2>
              <p className="mt-2 text-fg-muted">{mission.summary}</p>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-fg-muted">Mission progress</span>
                <span className="font-semibold">{progress}%</span>
              </div>
              <Progress value={progress} label={`${mission.title} progress`} />
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-4">
              <Link href={nextStepHref} className={buttonVariants()}>
                Continue: {STEP_LABELS[mission.currentStep]}
              </Link>
              <span className="text-sm text-fg-muted">About {mission.estimatedMinutes} min</span>
            </div>
          </Card>
        </section>

        <section aria-labelledby="activity-title">
          <Card className="h-full">
            <h2 id="activity-title" className="text-lg font-semibold">
              Recent activity
            </h2>
            <ul className="mt-4 space-y-4">
              {recentActivity.map((item) => (
                <li key={item.id} className="text-sm">
                  <p>{item.label}</p>
                  <p className="text-fg-muted">
                    <time dateTime={item.at}>{relativeTime(new Date(item.at), now)}</time>
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>

      <section aria-labelledby="tracks-title" className="mt-12">
        <h2 id="tracks-title" className="text-xl font-semibold">
          Your tracks
        </h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {tracks.map((t) => {
            const locked = t.status === "locked";
            const pct = t.missions ? Math.round((t.completedMissions / t.missions) * 100) : 0;
            return (
              <li key={t.id}>
                <Card
                  className={locked ? "h-full border-dashed border-border-strong bg-surface-2" : "h-full"}

                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{t.name}</h3>
                      <p className="text-sm text-fg-muted">{t.subject}</p>
                    </div>
                    {locked ? (
                      <Badge tone="muted">
                        <LockIcon />
                        <span>Locked</span>
                      </Badge>
                    ) : (
                      <Badge tone="accent">Available</Badge>
                    )}
                  </div>
                  {locked ? (
                    <p className="mt-4 text-sm text-fg-muted">{t.lockedReason}. We will open it after Excel and MathLab.</p>
                  ) : (
                    <div className="mt-4">
                      <p className="mb-2 text-sm text-fg-muted">
                        {t.completedMissions} of {t.missions} missions
                      </p>
                      <Progress value={pct} label={`${t.name} track progress`} />
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="next-step-title" className="mt-12">
        <Card className="flex flex-col items-start justify-between gap-4 bg-accent-subtle sm:flex-row sm:items-center">
          <div>
            <h2 id="next-step-title" className="text-lg font-semibold">
              Next step
            </h2>
            <p className="text-fg-muted">
              {STEP_LABELS[mission.currentStep]} for {mission.title}. You are {progress}% through this mission.
            </p>
          </div>
          <Link href={nextStepHref} className={buttonVariants()}>
            Resume mission
          </Link>
        </Card>
      </section>
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
