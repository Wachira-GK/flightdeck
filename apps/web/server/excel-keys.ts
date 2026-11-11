// SERVER-ONLY. Imports Excel exercise answer keys; never import this module from a client component
// or from anything under components/. `server-only` is not installed (no new dependencies), so the
// guards are: (1) server/excel-check.test.ts fails if any "use client" file or components/** imports
// from server/; (2) scripts/check-key-leak.mjs fails if key markers reach .next/static after a build.
import type { ExerciseDefinition, ExerciseKey } from "@flightdeck/excel-engine";
import { getExcelExercise } from "@/components/excel/exercises";
import commissionTierIfChainKey from "../../../content/excel/exercises/commission-tier-if-chain.key.json";
import ifBusinessThresholdsKey from "../../../content/excel/exercises/if-business-thresholds.key.json";
import sumRelativeRefsKey from "../../../content/excel/exercises/sum-relative-refs.key.json";
import xlookupPriceListKey from "../../../content/excel/exercises/xlookup-price-list.key.json";

const KEYS: Record<string, ExerciseKey> = {
  "sum-relative-refs": sumRelativeRefsKey as unknown as ExerciseKey,
  "if-business-thresholds": ifBusinessThresholdsKey as unknown as ExerciseKey,
  "commission-tier-if-chain": commissionTierIfChainKey as unknown as ExerciseKey,
  "xlookup-price-list": xlookupPriceListKey as unknown as ExerciseKey,
};

export interface GradableExercise {
  exercise: ExerciseDefinition;
  key: ExerciseKey;
}

/** Learner-safe exercise plus its server-only key, or undefined for an unknown id. */
export function getGradableExercise(id: string): GradableExercise | undefined {
  if (!Object.hasOwn(KEYS, id)) return undefined;
  const exercise = getExcelExercise(id);
  return exercise ? { exercise, key: KEYS[id]! } : undefined;
}

/** Ids that have both a learner-safe definition and a key. */
export const GRADABLE_EXERCISE_IDS = Object.keys(KEYS).filter((id) => getExcelExercise(id) !== undefined);
