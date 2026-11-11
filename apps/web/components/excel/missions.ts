import type { ExerciseDefinition } from "@flightdeck/excel-engine";

/**
 * Data-driven Excel mission contract (content/excel/missions/<slug>.json), mirroring the
 * Mathematics missions. Mission JSON is learner-safe: it never contains answers. Assessment keys
 * live in <slug>.keys.json and exercise keys in content/excel/exercises/<id>.key.json; both are
 * server-only.
 */
export const EXCEL_MISSION_STEP_IDS = ["briefing", "training", "simulation", "assessment", "debrief"] as const;
export type ExcelMissionStepId = (typeof EXCEL_MISSION_STEP_IDS)[number];

export type ExcelMissionBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  /** A formula example shown in monospace, with a plain-language explanation. */
  | { type: "formula"; formula: string; text: string }
  /** A small data table (accessible alternative to a screenshot of a sheet). */
  | { type: "table"; caption: string; columns: string[]; rows: string[][] }
  /** Mounts the interactive grid for the mission's exercise. */
  | { type: "excel-grid" }
  /** The exercise's hints, collapsed by default. */
  | { type: "exercise-hints" }
  | { type: "assessment-items"; itemIds: string[] };

export type ExcelMissionStep = { id: ExcelMissionStepId; title: string; blocks: ExcelMissionBlock[] };

export type ExcelAssessmentItem =
  | { id: string; type: "numeric"; prompt: string; answerHint?: string }
  | { id: string; type: "single-choice"; prompt: string; options: { id: string; label: string }[] };

export type ExcelMission = {
  schemaVersion: 1;
  slug: string;
  trackId: "excel";
  code: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  /** Fraction of assessment points needed to pass, e.g. 0.8. */
  passMark: number;
  /** Learner-safe exercise mounted in the simulation step (content/excel/exercises/<id>.json). */
  exerciseId: string;
  steps: ExcelMissionStep[];
  assessment: { items: ExcelAssessmentItem[] };
};

/** SERVER-ONLY assessment key (content/excel/missions/<slug>.keys.json). */
export type ExcelAnswerKeyItem =
  | { id: string; type: "numeric"; expected: number; tolerance: { kind: "absolute"; value: number }; rationale: string }
  | { id: string; type: "single-choice"; correctOptionId: string; rationale: string };

export type ExcelMissionKeys = { schemaVersion: 1; missionSlug: string; items: ExcelAnswerKeyItem[] };

/** Static consistency checks for a mission (and its keys, when given). Returns problems; empty = valid. */
export function validateExcelMission(
  mission: ExcelMission,
  exercise: ExerciseDefinition | undefined,
  keys?: ExcelMissionKeys,
): string[] {
  const issues: string[] = [];
  if (mission.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(mission.slug)) issues.push("slug must be kebab-case");
  if (mission.trackId !== "excel") issues.push("trackId must be excel");
  if (!/^EX-\d{3}$/.test(mission.code)) issues.push("code must look like EX-101");
  if (!(mission.passMark > 0 && mission.passMark <= 1)) issues.push("passMark must be in (0, 1]");
  if (!exercise || exercise.id !== mission.exerciseId) issues.push(`unknown exercise ${mission.exerciseId}`);
  const stepIds = mission.steps.map((s) => s.id);
  if (stepIds.join() !== EXCEL_MISSION_STEP_IDS.join()) issues.push(`steps must be ${EXCEL_MISSION_STEP_IDS.join(", ")}`);
  const itemIds = new Set(mission.assessment.items.map((i) => i.id));
  if (itemIds.size !== mission.assessment.items.length) issues.push("assessment item ids must be unique");
  const n = mission.assessment.items.length;
  if (n < 3 || n > 4) issues.push("assessment needs 3 or 4 items");
  for (const item of mission.assessment.items) {
    if (item.type === "single-choice" && item.options.length < 2) issues.push(`item ${item.id}: needs 2+ options`);
  }
  const placed = new Set<string>();
  for (const step of mission.steps) {
    for (const b of step.blocks) {
      if (b.type === "excel-grid" && step.id !== "simulation") issues.push(`${step.id}: excel-grid belongs in simulation`);
      if (b.type === "table" && b.rows.some((r) => r.length !== b.columns.length)) issues.push(`${step.id}: table row width`);
      if (b.type === "assessment-items") {
        for (const id of b.itemIds) {
          if (!itemIds.has(id)) issues.push(`${step.id}: unknown item ${id}`);
          placed.add(id);
        }
      }
    }
  }
  if (!mission.steps.find((s) => s.id === "simulation")?.blocks.some((b) => b.type === "excel-grid")) {
    issues.push("simulation step must mount the excel-grid");
  }
  for (const id of itemIds) if (!placed.has(id)) issues.push(`item ${id} is not shown in any step`);
  if (keys) {
    if (keys.missionSlug !== mission.slug) issues.push("keys missionSlug mismatch");
    const keyIds = new Set(keys.items.map((k) => k.id));
    for (const id of itemIds) if (!keyIds.has(id)) issues.push(`item ${id} has no key`);
    for (const key of keys.items) {
      const item = mission.assessment.items.find((i) => i.id === key.id);
      if (!item) {
        issues.push(`key ${key.id} has no item`);
        continue;
      }
      if (key.type !== item.type) issues.push(`key ${key.id}: type mismatch`);
      if (key.type === "single-choice" && item.type === "single-choice" && !item.options.some((o) => o.id === key.correctOptionId)) {
        issues.push(`key ${key.id}: option not found`);
      }
    }
  }
  return issues;
}
