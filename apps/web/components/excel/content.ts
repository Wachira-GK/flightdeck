import type { ExerciseDefinition } from "@flightdeck/excel-engine";
import { getExcelExercise } from "./exercises";
import type { ExcelMission } from "./missions";
import { MISSION_DEFINITIONS } from "./registry.generated";

/**
 * Client-safe Excel mission definitions (no answers), generated from content/excel/missions by
 * scripts/gen-excel-registry.mjs. Assessment keys (content/excel/missions/*.keys.json) and exercise keys
 * (content/excel/exercises/*.key.json) must only ever be read by server-side code in apps/web/server/.
 */
const EXCEL_MISSIONS: Record<string, ExcelMission> = MISSION_DEFINITIONS;

export const EXCEL_MISSION_SLUGS = Object.keys(EXCEL_MISSIONS);

export interface ExcelMissionContent {
  mission: ExcelMission;
  /** Learner-safe exercise for the simulation step. */
  exercise: ExerciseDefinition;
}

/** Mission plus its learner-safe exercise, or undefined for an unknown slug. Never includes keys. */
export function getExcelMission(slug: string): ExcelMissionContent | undefined {
  if (!Object.hasOwn(EXCEL_MISSIONS, slug)) return undefined;
  const mission = EXCEL_MISSIONS[slug]!;
  const exercise = getExcelExercise(mission.exerciseId);
  return exercise ? { mission, exercise } : undefined;
}
