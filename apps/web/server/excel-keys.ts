// SERVER-ONLY. Imports Excel exercise answer keys; never import this module from a client component
// or from anything under components/. `server-only` is not installed (no new dependencies), so the
// guards are: (1) server/excel-check.test.ts fails if any "use client" file or components/** imports
// from server/; (2) scripts/check-key-leak.mjs fails if key markers reach .next/static after a build.
// The key table is generated from content/excel/exercises/*.key.json (scripts/gen-excel-registry.mjs).
import type { ExerciseDefinition, ExerciseKey } from "@flightdeck/excel-engine";
import { getExcelExercise } from "@/components/excel/exercises";
import { EXERCISE_KEYS } from "./excel-registry.generated";

const KEYS: Record<string, ExerciseKey> = EXERCISE_KEYS;

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
