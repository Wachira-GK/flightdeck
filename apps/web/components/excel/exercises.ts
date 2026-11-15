import type { ExerciseDefinition } from "@flightdeck/excel-engine";
// Learner-safe exercise definitions only. The matching *.key.json files are server-only
// (apps/web/server/excel-keys.ts); never import them from this folder. The table is generated from
// content/excel/exercises by scripts/gen-excel-registry.mjs.
import { EXERCISE_DEFINITIONS } from "./registry.generated";

const EXERCISES: Record<string, ExerciseDefinition> = EXERCISE_DEFINITIONS;

/** Ids of every published Excel exercise. */
export const EXCEL_EXERCISE_IDS = Object.keys(EXERCISES);

/** Learner-safe exercise definition (no answers), or undefined for an unknown id. */
export function getExcelExercise(id: string): ExerciseDefinition | undefined {
  return Object.hasOwn(EXERCISES, id) ? EXERCISES[id] : undefined;
}
