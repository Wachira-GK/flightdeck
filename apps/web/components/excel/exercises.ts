import type { ExerciseDefinition } from "@flightdeck/excel-engine";
// Learner-safe exercise definitions only. The matching *.key.json files are server-only
// (apps/web/server/excel-keys.ts); never import them from this folder.
import commissionTierIfChain from "../../../../content/excel/exercises/commission-tier-if-chain.json";
import ifBusinessThresholds from "../../../../content/excel/exercises/if-business-thresholds.json";
import sumRelativeRefs from "../../../../content/excel/exercises/sum-relative-refs.json";
import xlookupPriceList from "../../../../content/excel/exercises/xlookup-price-list.json";

const EXERCISES: Record<string, ExerciseDefinition> = {
  "sum-relative-refs": sumRelativeRefs as unknown as ExerciseDefinition,
  "if-business-thresholds": ifBusinessThresholds as unknown as ExerciseDefinition,
  "commission-tier-if-chain": commissionTierIfChain as unknown as ExerciseDefinition,
  "xlookup-price-list": xlookupPriceList as unknown as ExerciseDefinition,
};

/** Ids of every published Excel exercise. */
export const EXCEL_EXERCISE_IDS = Object.keys(EXERCISES);

/** Learner-safe exercise definition (no answers), or undefined for an unknown id. */
export function getExcelExercise(id: string): ExerciseDefinition | undefined {
  return Object.hasOwn(EXERCISES, id) ? EXERCISES[id] : undefined;
}
