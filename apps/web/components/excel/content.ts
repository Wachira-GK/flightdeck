import type { ExerciseDefinition } from "@flightdeck/excel-engine";
import excelIf102 from "../../../../content/excel/missions/excel-if-102.json";
import excelLookup103 from "../../../../content/excel/missions/excel-lookup-103.json";
import excelSum101 from "../../../../content/excel/missions/excel-sum-101.json";
import { getExcelExercise } from "./exercises";
import type { ExcelMission } from "./missions";

/**
 * Client-safe Excel mission definitions (no answers). Assessment keys
 * (content/excel/missions/*.keys.json) and exercise keys (content/excel/exercises/*.key.json)
 * must only ever be read by server-side code in apps/web/server/.
 */
const EXCEL_MISSIONS: Record<string, ExcelMission> = {
  "excel-sum-101": excelSum101 as unknown as ExcelMission,
  "excel-if-102": excelIf102 as unknown as ExcelMission,
  "excel-lookup-103": excelLookup103 as unknown as ExcelMission,
};

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
