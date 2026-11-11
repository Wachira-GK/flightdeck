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
  /** Sent once when the Worker's module has loaded; request timeouts start only after this. */
  | { id: 0; type: "ready" }
  | { id: number; type: "evaluated"; values: Record<string, CellValue> }
  | { id: number; type: "validated"; result: ValidationResult }
  | { id: number; type: "error"; message: string };

/** Hard recalculation timeout from the threat model (TB7 / CT5). */
export const HARD_TIMEOUT_MS = 500;

/**
 * Time allowed for the Worker to download and start (network + script parse), which must not count
 * against the 500 ms calculation limit: on a slow phone connection start-up alone can exceed it.
 */
export const BOOT_TIMEOUT_MS = 15_000;
