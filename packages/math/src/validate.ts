/**
 * Input validation shared by every statistics function.
 * All functions in this package are pure: they never mutate their input and never read I/O.
 */

export type MathInputErrorCode = "EMPTY_DATASET" | "NON_FINITE_VALUE" | "NOT_AN_ARRAY" | "TOO_FEW_VALUES" | "ZERO_SPREAD" | "INVALID_ARGUMENT";

export class MathInputError extends Error {
  readonly code: MathInputErrorCode;

  constructor(code: MathInputErrorCode, message: string) {
    super(message);
    this.name = "MathInputError";
    this.code = code;
  }
}

/**
 * Throws a MathInputError unless `values` is a non-empty array of finite numbers
 * with at least `minLength` items. Returns the same array typed as readonly.
 */
export function assertDataset(values: unknown, minLength = 1): readonly number[] {
  if (!Array.isArray(values)) {
    throw new MathInputError("NOT_AN_ARRAY", "Dataset must be an array of numbers.");
  }
  if (values.length === 0) {
    throw new MathInputError("EMPTY_DATASET", "Dataset is empty: at least one value is required.");
  }
  values.forEach((v, i) => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new MathInputError(
        "NON_FINITE_VALUE",
        `Value at position ${i + 1} is not a finite number (got ${String(v)}).`,
      );
    }
  });
  if (values.length < minLength) {
    throw new MathInputError(
      "TOO_FEW_VALUES",
      `At least ${minLength} values are required (got ${values.length}).`,
    );
  }
  return values as readonly number[];
}

export function assertFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MathInputError("INVALID_ARGUMENT", `${name} must be a finite number (got ${String(value)}).`);
  }
  return value;
}
