/**
 * Pure mission-flow logic (no I/O). Mission > Briefing > Training > Simulation > Assessment > Debrief,
 * then Certificate at track level.
 */

export const MISSION_STEPS = ["briefing", "training", "simulation", "assessment", "debrief"] as const;
export type MissionStep = (typeof MISSION_STEPS)[number];

export const STEP_LABELS: Record<MissionStep, string> = {
  briefing: "Briefing",
  training: "Training",
  simulation: "Simulation",
  assessment: "Assessment",
  debrief: "Debrief",
};

export function isMissionStep(value: unknown): value is MissionStep {
  return typeof value === "string" && (MISSION_STEPS as readonly string[]).includes(value);
}

/**
 * Normalise an untrusted `?step=` search param. Arrays (repeated params) use the first value;
 * anything unknown falls back to the first step rather than throwing.
 */
export function parseStep(value: string | string[] | undefined): MissionStep {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalised = raw?.trim().toLowerCase();
  return isMissionStep(normalised) ? normalised : MISSION_STEPS[0];
}

export function stepIndex(step: MissionStep): number {
  return MISSION_STEPS.indexOf(step);
}

export function adjacentSteps(step: MissionStep): { prev: MissionStep | null; next: MissionStep | null } {
  const i = stepIndex(step);
  return {
    prev: i > 0 ? (MISSION_STEPS[i - 1] ?? null) : null,
    next: i < MISSION_STEPS.length - 1 ? (MISSION_STEPS[i + 1] ?? null) : null,
  };
}

export type StepStatus = "complete" | "current" | "upcoming";

/** Status of `step` while viewing `current`, given the steps the learner has completed. */
export function stepStatus(
  step: MissionStep,
  current: MissionStep,
  completed: readonly MissionStep[],
): StepStatus {
  if (step === current) return "current";
  return completed.includes(step) ? "complete" : "upcoming";
}

/** Whole-number percentage of steps completed, 0..100. Duplicates and unknown values are ignored. */
export function missionProgress(completed: readonly MissionStep[]): number {
  const unique = new Set(completed.filter(isMissionStep));
  return Math.round((unique.size / MISSION_STEPS.length) * 100);
}
