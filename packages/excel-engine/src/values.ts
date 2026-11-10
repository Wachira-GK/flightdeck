import { cellError, isCellError, type CellError, type CellValue } from "./types";

/**
 * Numeric-looking text that Excel coerces in arithmetic: optional sign, digits, decimal point,
 * exponent and an optional trailing %. Thousands separators, currency symbols and dates are NOT
 * coerced (documented deviation: Excel would coerce "1,000", "$5" and "1/2/2026").
 */
const NUMERIC_TEXT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/;

export function parseNumericText(text: string): number | null {
  const t = text.trim();
  if (!NUMERIC_TEXT_RE.test(t)) return null;
  const pct = t.endsWith("%");
  const n = Number(pct ? t.slice(0, -1) : t);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/** Arithmetic coercion: blank -> 0, TRUE -> 1, numeric text -> number, other text -> #VALUE!. */
export function toNumber(v: CellValue): number | CellError {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = parseNumericText(v);
    if (n === null) {
      const shown = v.length > 20 ? `${v.slice(0, 20)}...` : v;
      return cellError("#VALUE!", `"${shown}" is text, so it cannot be used in arithmetic`);
    }
    return n;
  }
  return v;
}

/** Condition coercion for IF: numbers (non-zero), booleans, blank (FALSE), "TRUE"/"FALSE" text. */
export function toBoolean(v: CellValue): boolean | CellError {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const u = v.trim().toUpperCase();
    if (u === "TRUE") return true;
    if (u === "FALSE") return false;
    return cellError("#VALUE!", "IF needs a TRUE/FALSE condition, but got text");
  }
  return v;
}

function trimMantissa(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Excel "General"-style number text: up to 15 significant digits, scientific for extremes. */
export function formatNumber(n: number): string {
  if (n === 0) return "0";
  if (!Number.isFinite(n)) return "#NUM!";
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-6) {
    const [mant, exp] = n.toExponential(14).split("e");
    const e = Number(exp);
    return `${trimMantissa(mant!)}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  return trimMantissa(n.toPrecision(15));
}

/** Text coercion for &: numbers in General format, TRUE/FALSE, blank -> "". */
export function toText(v: Exclude<CellValue, CellError>): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return formatNumber(v);
}

/** What a cell shows in the grid. */
export function formatValue(v: CellValue): string {
  if (v === null) return "";
  if (isCellError(v)) return v.error;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return formatNumber(v);
  return v;
}

function typeRank(v: number | string | boolean): number {
  return typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2;
}

/**
 * Excel comparison: blanks take the other side's type (0, "" or FALSE); otherwise
 * numbers < text < booleans; text compares case-insensitively. Text is NOT coerced to numbers
 * here, so ="1"=1 is FALSE, as in Excel.
 */
export function compareValues(a: Exclude<CellValue, CellError>, b: Exclude<CellValue, CellError>): number {
  let x = a;
  let y = b;
  if (x === null && y === null) return 0;
  if (x === null) x = typeof y === "number" ? 0 : typeof y === "string" ? "" : false;
  if (y === null) y = typeof x === "number" ? 0 : typeof x === "string" ? "" : false;
  const rx = typeRank(x!);
  const ry = typeRank(y!);
  if (rx !== ry) return rx < ry ? -1 : 1;
  if (typeof x === "string" && typeof y === "string") {
    const lx = x.toLowerCase();
    const ly = y.toLowerCase();
    return lx < ly ? -1 : lx > ly ? 1 : 0;
  }
  const nx = Number(x);
  const ny = Number(y);
  return nx < ny ? -1 : nx > ny ? 1 : 0;
}

/** Parses a non-formula cell input the way Excel's grid does for the supported subset. */
export function parseConstant(input: string): number | string | boolean {
  if (input.startsWith("'")) return input.slice(1);
  const n = parseNumericText(input);
  if (n !== null) return n;
  const u = input.trim().toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  return input;
}
