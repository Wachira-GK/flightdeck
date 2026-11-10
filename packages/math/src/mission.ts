import type { Tolerance } from "./grade";
import { isWithinTolerance, validateTolerance } from "./grade";
import { validateExplorerDataset, type StatsExplorerDataset } from "./explorer";
import { computeStatistic, isStatisticKind, type StatisticKind } from "./stats";

/**
 * Mathematics mission content shapes (content/math/missions/*.json) and their server-only answer keys
 * (*.keys.json). See content/math/MISSION-SPEC.md. Mission files must never contain answers.
 */

export const MATH_MISSION_STEP_IDS = ["briefing", "training", "simulation", "assessment", "debrief"] as const;
export type MathMissionStepId = (typeof MATH_MISSION_STEP_IDS)[number];

export type MissionBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  /** `alt` is the plain-language reading of the formula, used in captions and for review. */
  | { type: "math"; tex: string; displayMode?: boolean; alt: string }
  | { type: "definition"; term: string; tex: string; text: string; excel?: string }
  | { type: "stats-explorer"; datasetId: string; label?: string }
  | { type: "practice-numeric"; questionId: string }
  | { type: "assessment-items"; itemIds: string[] };

export type MathMissionStep = { id: MathMissionStepId; title: string; blocks: MissionBlock[] };

/** Ungraded practice check. Expected value is derived from the public dataset, so no key is needed client-side. */
export type PracticeNumericSpec = {
  id: string;
  prompt: string;
  datasetId: string;
  statistic: StatisticKind;
  decimals?: number;
  tolerance: Tolerance;
};

export type AssessmentItem =
  | { id: string; type: "numeric"; prompt: string; datasetId: string; answerHint?: string }
  | { id: string; type: "single-choice"; prompt: string; options: { id: string; label: string }[] };

export type MathMission = {
  schemaVersion: 1;
  slug: string;
  trackId: string;
  code: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  /** Fraction of assessment points needed to pass, e.g. 0.8. */
  passMark: number;
  datasets: StatsExplorerDataset[];
  practice: PracticeNumericSpec[];
  steps: MathMissionStep[];
  assessment: { items: AssessmentItem[] };
};

export type AnswerKeyItem =
  | {
      id: string;
      type: "numeric";
      expected: number;
      tolerance: Tolerance;
      explain: { statistic: StatisticKind; datasetId: string; decimals?: number };
    }
  | { id: string; type: "single-choice"; correctOptionId: string; rationale: string };

export type MathMissionKeys = { schemaVersion: 1; missionSlug: string; items: AnswerKeyItem[] };

/** Field names that would indicate an answer leaked into a client-visible mission file. */
const ANSWER_FIELDS = new Set(["expected", "correctOptionId", "answer", "answers", "solution", "rationale"]);

function findAnswerFields(node: unknown, path: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => findAnswerFields(n, `${path}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (ANSWER_FIELDS.has(k)) out.push(`${path}.${k}`);
      findAnswerFields(v, `${path}.${k}`, out);
    }
  }
}

/** Returns a list of problems; empty means the mission (and keys, if given) are consistent. */
export function validateMathMission(mission: MathMission, keys?: MathMissionKeys): string[] {
  const issues: string[] = [];
  const stepIds = mission.steps.map((s) => s.id).join(",");
  if (stepIds !== MATH_MISSION_STEP_IDS.join(",")) issues.push(`steps must be ${MATH_MISSION_STEP_IDS.join(" > ")}`);
  if (!(mission.passMark > 0 && mission.passMark <= 1)) issues.push("passMark must be in (0, 1]");

  const datasets = new Map(mission.datasets.map((d) => [d.id, d]));
  for (const d of mission.datasets) {
    try {
      validateExplorerDataset(d);
    } catch (e) {
      issues.push(`dataset ${d.id}: ${(e as Error).message}`);
    }
  }
  const practiceIds = new Set(mission.practice.map((p) => p.id));
  for (const p of mission.practice) {
    if (!datasets.has(p.datasetId)) issues.push(`practice ${p.id}: unknown dataset ${p.datasetId}`);
    if (!isStatisticKind(p.statistic)) issues.push(`practice ${p.id}: unknown statistic`);
    try {
      validateTolerance(p.tolerance);
    } catch (e) {
      issues.push(`practice ${p.id}: ${(e as Error).message}`);
    }
  }
  const itemIds = new Set(mission.assessment.items.map((i) => i.id));
  for (const item of mission.assessment.items) {
    if (item.type === "numeric" && !datasets.has(item.datasetId)) issues.push(`item ${item.id}: unknown dataset`);
    if (item.type === "single-choice" && item.options.length < 2) issues.push(`item ${item.id}: needs 2+ options`);
  }
  for (const step of mission.steps) {
    for (const b of step.blocks) {
      if (b.type === "stats-explorer" && !datasets.has(b.datasetId)) issues.push(`${step.id}: unknown dataset ${b.datasetId}`);
      if (b.type === "practice-numeric" && !practiceIds.has(b.questionId)) issues.push(`${step.id}: unknown practice ${b.questionId}`);
      if (b.type === "assessment-items") {
        for (const id of b.itemIds) if (!itemIds.has(id)) issues.push(`${step.id}: unknown item ${id}`);
      }
    }
  }
  const leaks: string[] = [];
  findAnswerFields(mission, "mission", leaks);
  for (const l of leaks) issues.push(`answer field in client-visible mission file: ${l}`);

  if (keys) {
    if (keys.missionSlug !== mission.slug) issues.push("keys.missionSlug does not match mission.slug");
    const keyById = new Map(keys.items.map((k) => [k.id, k]));
    for (const item of mission.assessment.items) {
      const key = keyById.get(item.id);
      if (!key) {
        issues.push(`item ${item.id}: no answer key`);
        continue;
      }
      if (key.type !== item.type) issues.push(`item ${item.id}: key type ${key.type} != item type ${item.type}`);
      if (key.type === "numeric") {
        const ds = datasets.get(key.explain.datasetId);
        if (!ds) {
          issues.push(`key ${key.id}: unknown dataset`);
          continue;
        }
        try {
          validateTolerance(key.tolerance);
          const actual = computeStatistic(key.explain.statistic, ds.values);
          if (!isWithinTolerance(key.expected, actual, key.tolerance)) {
            issues.push(`key ${key.id}: expected ${key.expected} but ${key.explain.statistic} of the dataset is ${actual}`);
          }
        } catch (e) {
          issues.push(`key ${key.id}: ${(e as Error).message}`);
        }
      }
      if (key.type === "single-choice" && item.type === "single-choice") {
        if (!item.options.some((o) => o.id === key.correctOptionId)) issues.push(`key ${key.id}: option not found`);
      }
    }
    for (const k of keys.items) if (!itemIds.has(k.id)) issues.push(`key ${k.id}: no matching item`);
  }
  return issues;
}

/** Props for <NumericQuestion> resolved from a mission's practice spec. */
export type NumericPracticeQuestion = {
  id: string;
  prompt: string;
  statistic: StatisticKind;
  dataset: number[];
  unit?: string;
  decimals?: number;
};

export function resolvePracticeQuestion(
  mission: MathMission,
  questionId: string,
): { question: NumericPracticeQuestion; tolerance: Tolerance } | undefined {
  const spec = mission.practice.find((p) => p.id === questionId);
  const ds = spec && mission.datasets.find((d) => d.id === spec.datasetId);
  if (!spec || !ds) return undefined;
  return {
    question: {
      id: spec.id,
      prompt: spec.prompt,
      statistic: spec.statistic,
      dataset: [...ds.values],
      unit: ds.unit,
      decimals: spec.decimals,
    },
    tolerance: spec.tolerance,
  };
}

export function getMissionDataset(mission: MathMission, datasetId: string): StatsExplorerDataset | undefined {
  return mission.datasets.find((d) => d.id === datasetId);
}
