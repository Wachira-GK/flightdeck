/**
 * Pure Cockpit logic (no I/O): turns the catalogue plus a learner's SAVED progress into what the
 * Cockpit shows. Saved progress only records Simulation passes and graded Assessments (server verdicts,
 * ADR-008), so earlier steps are inferred: a learner cannot reach Simulation without Briefing and
 * Training, and cannot reach Assessment before Simulation; a passed Assessment finishes the mission.
 */
import type { CatalogueMission, CatalogueTrack } from "./catalogue";
import { isMissionStep, MISSION_STEPS, missionProgress, type MissionStep } from "./mission";

export type SavedStep = { missionSlug: string; kind: string; at: string };
export type SavedAttempt = { missionSlug: string; passed: boolean; score: number; at: string };
export type SavedProgress = { steps: SavedStep[]; attempts: SavedAttempt[] };

export const EMPTY_PROGRESS: SavedProgress = { steps: [], attempts: [] };

export type CockpitTrack = {
  slug: string;
  title: string;
  subject: string;
  description: string;
  locked: boolean;
  lockedReason?: string;
  total: number;
  done: number;
};

export type ActiveMission = {
  mission: CatalogueMission;
  trackTitle: string;
  completedSteps: MissionStep[];
  currentStep: MissionStep;
  progress: number;
};

export type ActivityItem = { id: string; label: string; at: string };

export type CockpitView = {
  tracks: CockpitTrack[];
  /** null when every available mission is finished (or there are none). */
  active: ActiveMission | null;
  activity: ActivityItem[];
  startedAny: boolean;
};

/** Steps the learner has finished for one mission, in mission order. */
export function completedStepsFor(slug: string, progress: SavedProgress): MissionStep[] {
  const kinds = new Set(progress.steps.filter((s) => s.missionSlug === slug).map((s) => s.kind));
  const passed = progress.attempts.some((a) => a.missionSlug === slug && a.passed) || kinds.has("assessment");
  if (passed) return [...MISSION_STEPS];
  if (kinds.has("simulation")) return ["briefing", "training", "simulation"];
  return [];
}

export function isMissionComplete(slug: string, progress: SavedProgress): boolean {
  return completedStepsFor(slug, progress).length === MISSION_STEPS.length;
}

function nextStep(done: readonly MissionStep[]): MissionStep {
  return MISSION_STEPS.find((s) => !done.includes(s)) ?? "debrief";
}

export function buildCockpit(catalogue: readonly CatalogueTrack[], progress: SavedProgress, limit = 5): CockpitView {
  const bySlug = new Map<string, { mission: CatalogueMission; trackTitle: string }>();
  const tracks: CockpitTrack[] = catalogue.map((t) => {
    for (const m of t.missions) bySlug.set(m.slug, { mission: m, trackTitle: t.title });
    return {
      slug: t.slug,
      title: t.title,
      subject: t.subject,
      description: t.description,
      locked: t.status === "locked",
      ...(t.lockedReason ? { lockedReason: t.lockedReason } : {}),
      total: t.missions.length,
      done: t.missions.filter((m) => isMissionComplete(m.slug, progress)).length,
    };
  });

  let active: ActiveMission | null = null;
  for (const t of catalogue) {
    if (t.status === "locked") continue;
    const next = t.missions.find((m) => !isMissionComplete(m.slug, progress));
    if (next) {
      const completedSteps = completedStepsFor(next.slug, progress);
      active = { mission: next, trackTitle: t.title, completedSteps, currentStep: nextStep(completedSteps), progress: missionProgress(completedSteps) };
      break;
    }
  }

  const title = (slug: string) => bySlug.get(slug)?.mission.title ?? slug;
  const items: ActivityItem[] = [];
  for (const a of progress.attempts) {
    const pct = Math.round(a.score);
    items.push({
      id: `attempt-${a.missionSlug}-${a.at}`,
      label: a.passed ? `Passed Assessment: ${title(a.missionSlug)} (${pct}%)` : `Assessment attempt: ${title(a.missionSlug)} (${pct}%, not yet a pass)`,
      at: a.at,
    });
  }
  for (const s of progress.steps) {
    if (s.kind !== "simulation" || !isMissionStep(s.kind)) continue;
    items.push({ id: `step-${s.missionSlug}-${s.kind}`, label: `Completed Simulation: ${title(s.missionSlug)}`, at: s.at });
  }
  items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));

  return { tracks, active, activity: items.slice(0, limit), startedAny: progress.steps.length + progress.attempts.length > 0 };
}
