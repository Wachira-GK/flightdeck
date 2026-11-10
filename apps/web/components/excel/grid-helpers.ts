import { columnToLetters, formatValue, isCellError, type CellValue } from "@flightdeck/excel-engine";

/** Zero-based position of a data cell (row 0 = spreadsheet row 1). */
export interface GridPos {
  row: number;
  col: number;
}

export interface GridSize {
  rows: number;
  cols: number;
}

export function posToKey(pos: GridPos): string {
  return `${columnToLetters(pos.col)}${pos.row + 1}`;
}

export interface NavKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/**
 * Keyboard navigation for the grid (WAI-ARIA grid pattern). Returns the new position, or null
 * when the key is not a navigation key. Movement is clamped to the grid.
 */
export function moveSelection(pos: GridPos, e: NavKey, size: GridSize): GridPos | null {
  const ctrl = Boolean(e.ctrlKey || e.metaKey);
  const lastRow = size.rows - 1;
  const lastCol = size.cols - 1;
  const clampRow = (r: number) => Math.max(0, Math.min(lastRow, r));
  const clampCol = (c: number) => Math.max(0, Math.min(lastCol, c));
  switch (e.key) {
    case "ArrowUp":
      return { row: ctrl ? 0 : clampRow(pos.row - 1), col: pos.col };
    case "ArrowDown":
      return { row: ctrl ? lastRow : clampRow(pos.row + 1), col: pos.col };
    case "ArrowLeft":
      return { row: pos.row, col: ctrl ? 0 : clampCol(pos.col - 1) };
    case "ArrowRight":
      return { row: pos.row, col: ctrl ? lastCol : clampCol(pos.col + 1) };
    case "Home":
      return ctrl ? { row: 0, col: 0 } : { row: pos.row, col: 0 };
    case "End":
      return ctrl ? { row: lastRow, col: lastCol } : { row: pos.row, col: lastCol };
    case "PageUp":
      return { row: clampRow(pos.row - 10), col: pos.col };
    case "PageDown":
      return { row: clampRow(pos.row + 10), col: pos.col };
    default:
      return null;
  }
}

/** True for a key press that should start editing by replacing the cell content (Excel behaviour). */
export function isTypingKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * Accessible name for a cell, e.g. "B3, formula =SUM(B1:B2), value 5, editable".
 * Errors include the engine's explanation so screen-reader users hear why.
 */
export function cellAriaLabel(key: string, input: string, value: CellValue, editable: boolean): string {
  const parts = [key];
  if (input.startsWith("=")) parts.push(`formula ${input}`);
  const shown = formatValue(value);
  if (isCellError(value)) parts.push(`error ${value.error}: ${value.message}`);
  else parts.push(shown === "" ? "empty" : `value ${shown}`);
  parts.push(editable ? "editable" : "locked");
  return parts.join(", ");
}

export type CellAlign = "left" | "right" | "center";

/** Excel-style alignment: numbers right, booleans and errors centred, text left. */
export function cellAlign(value: CellValue): CellAlign {
  if (typeof value === "number") return "right";
  if (typeof value === "boolean" || isCellError(value)) return "center";
  return "left";
}

/** First editable cell in row-major order (the initial selection), or A1. */
export function firstEditable(editableCells: readonly string[], size: GridSize): GridPos {
  let best: GridPos | null = null;
  for (const k of editableCells) {
    const m = /^([A-Z]+)(\d+)$/.exec(k);
    if (!m) continue;
    let col = 0;
    for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
    const pos = { row: Number(m[2]) - 1, col: col - 1 };
    if (pos.row >= size.rows || pos.col >= size.cols) continue;
    if (!best || pos.row < best.row || (pos.row === best.row && pos.col < best.col)) best = pos;
  }
  return best ?? { row: 0, col: 0 };
}

/** Applies a committed edit to the input map ("" clears the cell). Returns a new object. */
export function applyEdit(inputs: Record<string, string>, key: string, input: string): Record<string, string> {
  const next = { ...inputs };
  if (input === "") delete next[key];
  else next[key] = input;
  return next;
}

/** Human summary of a practice-check result. */
export function checkSummary(passedCount: number, total: number, score: number, passed: boolean): string {
  return passed
    ? `All ${total} checks passed. Score ${score}.`
    : `${passedCount} of ${total} checks passed. Score ${score}.`;
}
