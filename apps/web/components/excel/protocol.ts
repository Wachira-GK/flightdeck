import type {
  CellValue,
  ExerciseDefinition,
  ExerciseKey,
  Limits,
  Submission,
  ValidationResult,
} from "@flightdeck/excel-engine";

/** Messages from the main thread to the engine Worker (plain JSON only). */
export type WorkerRequest =
  | { id: number; type: "evaluate"; cells: Record<string, string>; limits: Partial<Limits> }
  | { id: number; type: "validate"; exercise: ExerciseDefinition; submission: Submission; key?: ExerciseKey };

/** Messages from the engine Worker back to the main thread. */
export type WorkerResponse =
  | { id: number; type: "evaluated"; values: Record<string, CellValue> }
  | { id: number; type: "validated"; result: ValidationResult }
  | { id: number; type: "error"; message: string };

/** Hard recalculation timeout from the threat model (TB7 / CT5). */
export const HARD_TIMEOUT_MS = 500;
