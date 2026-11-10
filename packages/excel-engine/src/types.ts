/**
 * Core value and limit types for the FlightDeck Excel simulator engine.
 *
 * Security (threat model CT5 / TB7): this package is pure computation. It never uses eval,
 * `new Function`, `with`, dynamic import, timers, Date, Math.random, network, storage or clipboard.
 */

export const ENGINE_VERSION = "0.1.0";

/** Error codes a cell can hold. `#CIRC!` and `#LIMIT!` are FlightDeck-specific (documented). */
export type ErrorCode =
  | "#DIV/0!"
  | "#VALUE!"
  | "#NAME?"
  | "#NUM!"
  | "#REF!"
  | "#CIRC!"
  | "#LIMIT!"
  | "#ERROR!";

export interface CellError {
  readonly error: ErrorCode;
  readonly message: string;
}

/**
 * A computed cell value. `null` is a blank cell. All variants are plain JSON so values can cross
 * the Web Worker boundary and be stored as evidence.
 */
export type CellValue = number | string | boolean | null | CellError;

export function isCellError(v: unknown): v is CellError {
  return typeof v === "object" && v !== null && typeof (v as { error?: unknown }).error === "string";
}

export function cellError(error: ErrorCode, message: string): CellError {
  return { error, message };
}

export interface Limits {
  /** Grid rows (1..maxRows). Default 100. */
  maxRows: number;
  /** Grid columns (A..). Default 30 (A..AD). */
  maxCols: number;
  /** Non-empty cells. Default 500. */
  maxCells: number;
  /** Maximum AST depth of one formula. Default 30. */
  maxAstDepth: number;
  /** Total dependency edges (precedent cells, ranges expanded) across the sheet. Default 5000. */
  maxEdges: number;
  /** Maximum formula length in characters, including the leading "=". Default 1024. */
  maxFormulaLength: number;
  /** Maximum text length of a constant or a computed string (Excel's cell limit). Default 32767. */
  maxStringLength: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxRows: 100,
  maxCols: 30,
  maxCells: 500,
  maxAstDepth: 30,
  maxEdges: 5000,
  maxFormulaLength: 1024,
  maxStringLength: 32767,
});

export function resolveLimits(partial?: Partial<Limits>): Limits {
  const out: Limits = { ...DEFAULT_LIMITS };
  if (partial) {
    for (const k of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
      const v = partial[k];
      if (v !== undefined) {
        if (!Number.isInteger(v) || v < 1) throw new RangeError(`Limit ${k} must be a positive integer`);
        out[k] = v;
      }
    }
  }
  // Column letters are supported up to three letters, as in Excel.
  if (out.maxCols > 16384) throw new RangeError("maxCols cannot exceed 16384");
  return out;
}

export type LimitKind =
  | "grid"
  | "cells"
  | "astDepth"
  | "edges"
  | "formulaLength"
  | "stringLength";

/** Base class for typed engine errors. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** Raised when any configured limit is exceeded. The affected cell shows `#LIMIT!`. */
export class LimitError extends EngineError {
  constructor(
    readonly limit: LimitKind,
    message: string,
  ) {
    super(message, "#LIMIT!");
    this.name = "LimitError";
  }
}

/** Raised for formulas that cannot be parsed (`#ERROR!`) or use unsupported names (`#NAME?`). */
export class ParseError extends EngineError {
  constructor(
    message: string,
    code: "#ERROR!" | "#NAME?",
    readonly position: number,
  ) {
    super(message, code);
    this.name = "ParseError";
  }
}
