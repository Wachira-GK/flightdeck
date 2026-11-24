import { columnToLetters, formatValue, isCellError, shiftFormula, type CellValue } from "@flightdeck/excel-engine";

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

// ---------------------------------------------------------------------------
// Typing formulas like Excel: automatic closing brackets and point-and-click references
// ---------------------------------------------------------------------------

/**
 * Excel completes a formula you leave open: =SUM(B2:B4 plus Enter is stored as =SUM(B2:B4).
 * Adds the missing ")" at the end (brackets inside "quotes" do not count). Non-formulas are unchanged.
 */
export function closeParens(draft: string): string {
  if (!draft.startsWith("=")) return draft;
  let depth = 0;
  let inString = false;
  for (const ch of draft) {
    if (ch === '"') inString = !inString;
    else if (!inString && ch === "(") depth += 1;
    else if (!inString && ch === ")" && depth > 0) depth -= 1;
  }
  return depth > 0 ? draft + ")".repeat(depth) : draft;
}

/**
 * True when a cell reference may be inserted at the caret by clicking a cell or pressing an arrow key (Excel's "Point" mode):
 * the formula starts with "=" and the text before the caret ends with "=", "(", ",", or an operator, outside quotes.
 */
export function canPointAt(draft: string, caret: number): boolean {
  if (!draft.startsWith("=") || caret < 1 || caret > draft.length) return false;
  const before = draft.slice(0, caret);
  if (((before.match(/"/g) ?? []).length) % 2 === 1) return false;
  const last = before.trimEnd().slice(-1);
  return last !== "" && "=(,+-*/^&<>".includes(last);
}

/** "B2" for one cell, "B2:B4" for a block, always top-left first (like dragging in either direction). */
export function rangeText(a: GridPos, b: GridPos): string {
  const tl = { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) };
  const br = { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) };
  return tl.row === br.row && tl.col === br.col ? posToKey(tl) : `${posToKey(tl)}:${posToKey(br)}`;
}

/** The span of the reference most recently pointed at, so the next click replaces it instead of adding another. */
export interface PointSpan {
  start: number;
  end: number;
}

/** Inserts (or replaces the previously pointed) reference at the caret. Returns the new draft and the span of the reference. */
export function insertPointRef(draft: string, caret: number, prev: PointSpan | null, text: string): { draft: string; start: number; end: number } {
  const start = prev && prev.end === caret ? prev.start : caret;
  return { draft: draft.slice(0, start) + text + draft.slice(caret), start, end: start + text.length };
}

/** True when pointing is possible: either right after an operator/bracket, or straight after the reference we just pointed at. */
export function pointingAllowed(draft: string, caret: number, prev: PointSpan | null): boolean {
  return (prev !== null && prev.end === caret && draft.startsWith("=")) || canPointAt(draft, caret);
}

// ---------------------------------------------------------------------------
// Fill handle (drag the small square at the corner of the selected cell)
// ---------------------------------------------------------------------------

const NUMBER_LOOKING = /^[-+]?[$£€]?[\d,]*\.?\d+%?$/;

/**
 * The content of a cell filled (dRow, dCol) away from its source, like Excel:
 * a formula keeps its relative references moving, "Item1" counts up to "Item2", a plain number is copied.
 */
export function fillCell(source: string, dRow: number, dCol: number): string {
  if (source.startsWith("=")) return shiftFormula(source, dRow, dCol);
  if (source.trim() === "" || NUMBER_LOOKING.test(source.trim())) return source;
  const m = /^(.*?)(\d+)$/.exec(source);
  if (!m) return source;
  const n = Number(m[2]) + dRow + dCol;
  return n < 0 ? source : m[1] + String(n).padStart(m[2]!.length, "0");
}

export interface FillStep {
  pos: GridPos;
  dRow: number;
  dCol: number;
}

/** The cells covered by dragging the fill handle from `from` to `to`: along the longer direction only, nearest first. */
export function fillTargets(from: GridPos, to: GridPos, size: GridSize): FillStep[] {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (dr === 0 && dc === 0) return [];
  const vertical = Math.abs(dr) >= Math.abs(dc);
  const span = vertical ? dr : dc;
  const steps: FillStep[] = [];
  for (let i = 1; i <= Math.abs(span); i += 1) {
    const k = i * Math.sign(span);
    const pos = vertical ? { row: from.row + k, col: from.col } : { row: from.row, col: from.col + k };
    if (pos.row < 0 || pos.col < 0 || pos.row >= size.rows || pos.col >= size.cols) continue;
    steps.push({ pos, dRow: vertical ? k : 0, dCol: vertical ? 0 : k });
  }
  return steps;
}

/** Fills the source cell into the dragged range. Locked cells are skipped (and counted) rather than overwritten. */
export function applyFill(
  inputs: Record<string, string>,
  from: GridPos,
  to: GridPos,
  size: GridSize,
  editable: ReadonlySet<string>,
): { next: Record<string, string>; filled: number; skipped: number } {
  const source = inputs[posToKey(from)] ?? "";
  let next = inputs;
  let filled = 0;
  let skipped = 0;
  for (const step of fillTargets(from, to, size)) {
    const key = posToKey(step.pos);
    if (!editable.has(key)) {
      skipped += 1;
      continue;
    }
    next = applyEdit(next, key, fillCell(source, step.dRow, step.dCol));
    filled += 1;
  }
  return { next, filled, skipped };
}

/** Double-clicking the fill handle: fill down as far as the neighbouring column (left first, then right) has data. */
export function autoFillExtent(inputs: Record<string, string>, from: GridPos, size: GridSize): GridPos | null {
  for (const col of [from.col - 1, from.col + 1]) {
    if (col < 0 || col >= size.cols) continue;
    let row = from.row + 1;
    while (row < size.rows && (inputs[posToKey({ row, col })] ?? "") !== "") row += 1;
    if (row - 1 > from.row) return { row: row - 1, col: from.col };
  }
  return null;
}
