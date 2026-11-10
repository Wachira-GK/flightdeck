import { LimitError, type Limits } from "./types";

/** Zero-based cell address. */
export interface CellAddress {
  row: number;
  col: number;
}

export interface CellRefParts extends CellAddress {
  absRow: boolean;
  absCol: boolean;
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})$/;
const PLAIN_REF_RE = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/;

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnToLetters(col: number): string {
  if (!Number.isInteger(col) || col < 0) throw new RangeError("column must be a non-negative integer");
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" -> 0, "AD" -> 29 (case-insensitive). */
export function lettersToColumn(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) throw new RangeError(`Invalid column letters: ${letters}`);
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Parses "B3", "$B$3", "b$3". Returns null if the text is not a cell reference. */
export function parseCellRef(text: string): CellRefParts | null {
  const m = REF_RE.exec(text);
  if (!m) return null;
  return {
    absCol: m[1] === "$",
    col: lettersToColumn(m[2]!),
    absRow: m[3] === "$",
    row: Number(m[4]) - 1,
  };
}

/** Formats a zero-based address as a canonical key, e.g. {row:2,col:1} -> "B3". */
export function toKey(addr: CellAddress): string {
  return `${columnToLetters(addr.col)}${addr.row + 1}`;
}

/** Parses a canonical/plain key ("B3", "b3"); no `$`. Returns null when invalid. */
export function parseKey(key: string): CellAddress | null {
  const m = PLAIN_REF_RE.exec(key);
  if (!m) return null;
  return { col: lettersToColumn(m[1]!), row: Number(m[2]) - 1 };
}

export function isInGrid(addr: CellAddress, limits: Pick<Limits, "maxRows" | "maxCols">): boolean {
  return addr.row >= 0 && addr.col >= 0 && addr.row < limits.maxRows && addr.col < limits.maxCols;
}

export function gridLabel(limits: Pick<Limits, "maxRows" | "maxCols">): string {
  return `A1:${columnToLetters(limits.maxCols - 1)}${limits.maxRows}`;
}

/**
 * Normalises a user-supplied reference ("b3", "$B$3") to a canonical key ("B3") and checks it
 * is inside the grid. Throws RangeError for malformed refs and LimitError for out-of-grid refs.
 */
export function normalizeRef(ref: string, limits: Pick<Limits, "maxRows" | "maxCols">): string {
  const parts = parseCellRef(ref.trim());
  if (!parts) throw new RangeError(`Invalid cell reference: ${ref.slice(0, 20)}`);
  if (!isInGrid(parts, limits)) {
    throw new LimitError("grid", `${toKey(parts)} is outside the practice grid ${gridLabel(limits)}`);
  }
  return toKey(parts);
}

/** Row-major comparison for deterministic ordering of keys. */
export function compareKeys(a: string, b: string): number {
  const pa = parseKey(a);
  const pb = parseKey(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  return pa.row - pb.row || pa.col - pb.col;
}
