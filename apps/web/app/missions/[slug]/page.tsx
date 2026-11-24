import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, buttonVariants, Card, Progress } from "@flightdeck/ui";
import { ActiveTimeBeat } from "@/components/activity-beat";
import { ExcelMissionStep, getExcelMission, type ExcelMissionContent } from "@/components/excel";
import { getMathMission, MathMissionStep } from "@/components/math";
import { StepRail } from "@/components/step-rail";
import { adjacentSteps, MISSION_STEPS, missionProgress, parseStep, STEP_LABELS, stepIndex, type MissionStep } from "@/lib/mission";
import { getMission, getTrack, type Mission } from "@/lib/mock-data";
import { accessConfig, accessMessage, missionAccess } from "@/server/access";
import { touchVisit } from "@/server/activity";
import { contentForLearner } from "@/server/content-db";
import { currentUserId } from "@/server/current-user";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

interface Loaded {
  mission: Mission;
  /** Excel content to render; from the database (learner's pinned revision) or the built-in files. */
  excel?: ExcelMissionContent;
}

function toMission(ex: ExcelMissionContent["mission"]): Mission {
  return { slug: ex.slug, trackId: "excel", code: ex.code, title: ex.title, summary: ex.summary, estimatedMinutes: ex.estimatedMinutes, completedSteps: [], currentStep: "briefing" };
}

/**
 * The 4 hand-written prototype missions; else a published Excel mission from the database (the learner's pinned
 * revision when `pin` is set); else the built-in files. A database problem silently falls back to the files.
 */
async function loadMission(slug: string, userId: string | null, pin: boolean): Promise<Loaded | undefined> {
  const proto = getMission(slug);
  if (proto) return { mission: proto };
  const db = await contentForLearner(userId, slug, pin);
  if (db && db.track === "excel") return { mission: toMission(db.mission), excel: { mission: db.mission, exercise: db.exercise } };
  const ex = getExcelMission(slug);
  return ex ? { mission: toMission(ex.mission), excel: ex } : undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadMission(slug, null, false);
  return { title: loaded ? loaded.mission.title : "Mission not found" };
}

export default async function MissionPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const userId = await currentUserId();
  const preview = await loadMission(slug, userId, false); // no pin yet: a closed mission must not pin anything
  if (!preview) notFound();
  let mission = preview.mission;

  // Access rules (ADR-011): free tier, availability switch, per-learner unlocks. A closed mission sends no content.
  const [access] = await Promise.all([missionAccess(accessConfig(), userId, slug), touchVisit(userId)]); // touchVisit: activity log, best effort
  if (access !== "open") {
    const msg = accessMessage(access);
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <Card className="p-6">
          <p className="text-sm text-fg-muted">{mission.code}</p>
          <h1 className="mt-1 text-2xl font-semibold">{msg.title}</h1>
          <p className="mt-3 text-fg-muted">{msg.body}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {access === "locked" && !userId ? (
              <Link href={`/sign-in?next=${encodeURIComponent(`/missions/${slug}`)}`} className={buttonVariants()}>
                Sign in
              </Link>
            ) : null}
            <Link href="/cockpit" className={buttonVariants({ variant: "secondary" })}>
              Back to Cockpit
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Open: a signed-in learner is pinned to the revision they first open, so a newer publish never changes a mission mid-way.
  let excelMission = preview.excel;
  if (userId && excelMission) {
    const pinned = await loadMission(slug, userId, true);
    if (pinned?.excel) {
      excelMission = pinned.excel;
      mission = pinned.mission;
    }
  }
  const mathMission = mission.trackId === "mathlab" ? getMathMission(mission.slug) : undefined;
  const step = parseStep((await searchParams).step);
  const track = getTrack(mission.trackId);
  const { prev, next } = adjacentSteps(step);
  const progress = missionProgress(mission.completedSteps);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {userId ? <ActiveTimeBeat slug={slug} /> : null}
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <ol className="flex flex-wrap gap-2">
          <li>
            <Link href="/cockpit" className="underline-offset-4 hover:underline">
              Cockpit
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>{track?.name}</li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-fg">
            {mission.code}
          </li>
        </ol>
      </nav>

      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">{mission.title}</h1>
          <p className="mt-1 text-fg-muted">{mission.summary}</p>
        </div>
        <div className="w-full sm:w-56">
          <p className="mb-2 text-sm text-fg-muted">{progress}% complete</p>
          <Progress value={progress} label={`${mission.title} progress`} />
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside aria-label="Mission navigation" className="min-w-0">
          <StepRail slug={mission.slug} current={step} completed={mission.completedSteps} />
        </aside>

        <section aria-labelledby="step-title" className="min-w-0">
          <Card className="min-h-80 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <Badge tone="accent">
                Step {stepIndex(step) + 1} of {MISSION_STEPS.length}
              </Badge>
            </div>
            <h2 id="step-title" className="mt-3 text-2xl font-semibold">
              {STEP_LABELS[step]}
            </h2>
            <div className="mt-4 space-y-4 text-fg">
              {mathMission ? (
                <MathMissionStep mission={mathMission} step={step} />
              ) : excelMission ? (
                <ExcelMissionStep mission={excelMission} step={step} />
              ) : (
                <StepContent step={step} mission={mission} />
              )}
            </div>
          </Card>

          <div className="mt-6 flex justify-between gap-4">
            {prev ? (
              <Link
                href={`/missions/${mission.slug}?step=${prev}`}
                scroll={false}
                className={buttonVariants({ variant: "secondary" })}
              >
                <span aria-hidden="true">←</span> {STEP_LABELS[prev]}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/missions/${mission.slug}?step=${next}`} scroll={false} className={buttonVariants()}>
                {STEP_LABELS[next]} <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <Link href="/cockpit" className={buttonVariants()}>
                Back to Cockpit
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StepContent({ step, mission }: { step: MissionStep; mission: Mission }) {
  switch (step) {
    case "briefing":
      return (
        <>
          <p>
            Finance needs the quarter&apos;s sales total before the 10:00 review. You will use{" "}
            <code className="rounded-sm bg-surface-2 px-1 font-mono">SUM</code> to add a range of cells instead of
            typing every number.
          </p>
          <ul className="list-disc space-y-1 pl-6 text-fg-muted">
            <li>Objective: total a column with one formula.</li>
            <li>Time: about {mission.estimatedMinutes} minutes.</li>
            <li>You pass the mission at 80% or more in the Assessment.</li>
          </ul>
        </>
      );
    case "training":
      return (
        <>
          <p>
            <code className="rounded-sm bg-surface-2 px-1 font-mono">=SUM(B2:B4)</code> adds every value from B2 to
            B4. The colon means &ldquo;through&rdquo;, so the formula keeps working if a value changes.
          </p>
          <p className="text-fg-muted">
            Tip: select the range with your keyboard using Shift and the arrow keys, then press Enter.
          </p>
        </>
      );
    case "simulation":
      return <p>This mission has no simulation yet.</p>;
    case "assessment":
      return (
        <p>
          Three short questions check that you can choose the right range. Questions and scoring arrive with the
          assessment engine; this page is a layout prototype.
        </p>
      );
    case "debrief":
      return (
        <>
          <p>Mission summary: SUM totals a range, ranges use a colon, and totals update automatically.</p>
          <p className="text-fg-muted">Complete every mission in the Excel Masterclass to earn its Certificate.</p>
        </>
      );
  }
}
