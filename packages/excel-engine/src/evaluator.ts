import type { AstNode, FunctionName } from "./parser";
import { toKey } from "./refs";
import { cellError, isCellError, type CellError, type CellValue } from "./types";
import { compareValues, parseNumericText, toBoolean, toNumber, toText } from "./values";

export interface EvalContext {
  /** Current value of a cell (null when blank). Keys are canonical ("B3"). */
  getCell(key: string): CellValue;
  maxStringLength: number;
  /**
   * Cells one formula may scan through SUMIF/COUNTIF/AVERAGEIF/SUMIFS/COUNTIFS (the calculation
   * budget for the conditional aggregates). Default 20,000; the workbook passes 4 x maxEdges.
   */
  maxScanCells?: number;
  /** Internal per-formula scan counter, created by evaluateAst. */
  scan?: { used: number };
}

const DEFAULT_MAX_SCAN_CELLS = 20000;

const RANGE_IN_SCALAR = cellError(
  "#VALUE!",
  "A range like A1:B5 can only be used inside a function that takes ranges (SUM, AVERAGE, MIN, MAX, COUNT, MEDIAN, AND, OR, SUMIF, COUNTIF, AVERAGEIF, SUMIFS, COUNTIFS) or as an XLOOKUP lookup/return range",
);

function numResult(n: number): number | CellError {
  if (Number.isNaN(n) || !Number.isFinite(n)) return cellError("#NUM!", "The result is not a valid number (too large or undefined)");
  return n;
}

function arithmetic(op: string, a: number, b: number): number | CellError {
  switch (op) {
    case "+":
      return numResult(a + b);
    case "-":
      return numResult(a - b);
    case "*":
      return numResult(a * b);
    case "/":
      if (b === 0) return cellError("#DIV/0!", "Division by zero");
      return numResult(a / b);
    case "^":
      if (a === 0 && b === 0) return cellError("#NUM!", "0^0 is undefined");
      if (a === 0 && b < 0) return cellError("#DIV/0!", "Division by zero (0 raised to a negative power)");
      return numResult(a ** b);
    default:
      return cellError("#ERROR!", `Unknown operator ${op}`);
  }
}

function evalScalar(node: AstNode, ctx: EvalContext): CellValue {
  switch (node.type) {
    case "number":
      return numResult(node.value);
    case "string":
      return node.value;
    case "boolean":
      return node.value;
    case "ref":
      return ctx.getCell(node.key);
    case "range":
      return RANGE_IN_SCALAR;
    case "unary": {
      const v = evalScalar(node.operand, ctx);
      if (isCellError(v)) return v;
      if (node.op === "+") return v;
      const n = toNumber(v);
      if (isCellError(n)) return n;
      return n === 0 ? 0 : -n;
    }
    case "percent": {
      const v = evalScalar(node.operand, ctx);
      if (isCellError(v)) return v;
      const n = toNumber(v);
      if (isCellError(n)) return n;
      return n / 100;
    }
    case "binary": {
      const l = evalScalar(node.left, ctx);
      if (isCellError(l)) return l;
      const r = evalScalar(node.right, ctx);
      if (isCellError(r)) return r;
      switch (node.op) {
        case "&": {
          const s = toText(l) + toText(r);
          if (s.length > ctx.maxStringLength) {
            return cellError("#VALUE!", `Text result is longer than ${ctx.maxStringLength} characters`);
          }
          return s;
        }
        case "=":
          return compareValues(l, r) === 0;
        case "<>":
          return compareValues(l, r) !== 0;
        case "<":
          return compareValues(l, r) < 0;
        case ">":
          return compareValues(l, r) > 0;
        case "<=":
          return compareValues(l, r) <= 0;
        case ">=":
          return compareValues(l, r) >= 0;
        default: {
          const a = toNumber(l);
          if (isCellError(a)) return a;
          const b = toNumber(r);
          if (isCellError(b)) return b;
          return arithmetic(node.op, a, b);
        }
      }
    }
    case "call":
      return evalCall(node.name, node.args, ctx);
  }
}

/**
 * Collects the numbers an aggregate function sees. References and ranges follow Excel's range
 * rules (only numbers count; text, booleans and blanks are ignored). Direct arguments are
 * coerced (SUM(TRUE, "2") is 3). Errors propagate, except in COUNT, which ignores them.
 */
function collectNumbers(name: FunctionName, args: AstNode[], ctx: EvalContext): number[] | CellError {
  const isCount = name === "COUNT";
  const nums: number[] = [];
  for (const arg of args) {
    if (arg.type === "ref" || arg.type === "range") {
      const r0 = arg.type === "ref" ? arg.ref.row : arg.start.row;
      const r1 = arg.type === "ref" ? arg.ref.row : arg.end.row;
      const c0 = arg.type === "ref" ? arg.ref.col : arg.start.col;
      const c1 = arg.type === "ref" ? arg.ref.col : arg.end.col;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const v = ctx.getCell(toKey({ row: r, col: c }));
          if (isCellError(v)) {
            if (isCount) continue;
            return v;
          }
          if (typeof v === "number") nums.push(v);
        }
      }
      continue;
    }
    const v = evalScalar(arg, ctx);
    if (isCellError(v)) {
      if (isCount) continue;
      return v;
    }
    if (v === null) continue;
    if (isCount) {
      if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && parseNumericText(v) !== null)) {
        nums.push(0);
      }
      continue;
    }
    const n = toNumber(v);
    if (isCellError(n)) return n;
    nums.push(n);
  }
  return nums;
}

/** Cell keys of a 1-D reference or range, in order, or an error when it is not a 1-D range. */
function lookupCells(node: AstNode, what: string): { keys: string[]; rows: number; cols: number } | CellError {
  if (node.type !== "ref" && node.type !== "range") {
    return cellError("#VALUE!", `XLOOKUP needs a cell range for the ${what}, for example $A$2:$A$10`);
  }
  const start = node.type === "ref" ? node.ref : node.start;
  const end = node.type === "ref" ? node.ref : node.end;
  const rows = end.row - start.row + 1;
  const cols = end.col - start.col + 1;
  if (rows > 1 && cols > 1) {
    return cellError("#VALUE!", `XLOOKUP's ${what} must be a single row or a single column, not a ${rows}x${cols} block`);
  }
  const keys: string[] = [];
  for (let r = start.row; r <= end.row; r++) {
    for (let c = start.col; c <= end.col; c++) keys.push(toKey({ row: r, col: c }));
  }
  return { keys, rows, cols };
}

/**
 * Exact-match equality for XLOOKUP: same type only (a number never matches numeric text, as in
 * Excel); text is case-insensitive; a blank lookup value matches only a blank cell.
 */
function lookupEquals(needle: Exclude<CellValue, CellError>, v: CellValue): boolean {
  if (isCellError(v)) return false;
  if (needle === null || v === null) return needle === v;
  if (typeof needle !== typeof v) return false;
  if (typeof needle === "string") return needle.toLowerCase() === (v as string).toLowerCase();
  return needle === v;
}

/**
 * XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found]), exact match only (ADR-004).
 * First match wins. Errors inside lookup_array are skipped (they never match); an error in the
 * matched return cell is returned. if_not_found is evaluated lazily, only when nothing matches.
 */
function evalXlookup(args: AstNode[], ctx: EvalContext): CellValue {
  if (args.length > 4) {
    return cellError(
      "#VALUE!",
      "This simulator's XLOOKUP supports exact match only: remove the match_mode/search_mode arguments (use 3 or 4 arguments)",
    );
  }
  const needle = evalScalar(args[0]!, ctx);
  if (isCellError(needle)) return needle;
  const look = lookupCells(args[1]!, "lookup_array");
  if (isCellError(look)) return look;
  const ret = lookupCells(args[2]!, "return_array");
  if (isCellError(ret)) return ret;
  if (look.rows !== ret.rows || look.cols !== ret.cols) {
    return cellError(
      "#VALUE!",
      `XLOOKUP's lookup_array (${look.rows}x${look.cols}) and return_array (${ret.rows}x${ret.cols}) must be the same size`,
    );
  }
  for (let i = 0; i < look.keys.length; i++) {
    if (lookupEquals(needle, ctx.getCell(look.keys[i]!))) return ctx.getCell(ret.keys[i]!);
  }
  if (args[3]) return evalScalar(args[3], ctx);
  return cellError("#N/A", "XLOOKUP found no exact match for the lookup value");
}

// ---------------------------------------------------------------------------------------------
// Engine 0.3.0 functions (ADR-004 addendum): numeric/logic scalars, conditional aggregates, text.
// No regular expressions are built from user input and nothing is evaluated dynamically.
// ---------------------------------------------------------------------------------------------

/** Excel ROUND: half away from zero on the 15-significant-digit decimal value (ROUND(2.675,2) = 2.68). */
function excelRound(n: number, digits: number): number {
  if (n === 0) return 0;
  if (digits > 400) return n;
  if (digits < -400) return 0;
  const abs = Math.abs(n);
  const [m, e] = abs.toExponential(14).split("e");
  const shifted = Number(`${m}e${Number(e) + digits}`);
  if (!Number.isFinite(shifted)) return n;
  const r = Math.round(shifted); // shifted >= 0, so a .5 tie rounds up = away from zero
  if (r === 0) return 0;
  const [rm, re] = r.toExponential().split("e");
  const out = Number(`${rm}e${Number(re) - digits}`);
  if (!Number.isFinite(out)) return n;
  return n < 0 ? -out : out;
}

function evalRound(args: AstNode[], ctx: EvalContext): CellValue {
  const v = evalScalar(args[0]!, ctx);
  if (isCellError(v)) return v;
  const n = toNumber(v);
  if (isCellError(n)) return n;
  const dv = evalScalar(args[1]!, ctx);
  if (isCellError(dv)) return dv;
  const d = toNumber(dv);
  if (isCellError(d)) return d;
  return numResult(excelRound(n, Math.trunc(d)));
}

/** Logical values AND/OR see: ranges/refs use range rules (text and blanks ignored); direct arguments are coerced. */
function collectLogicals(name: string, args: AstNode[], ctx: EvalContext): boolean[] | CellError {
  const out: boolean[] = [];
  for (const arg of args) {
    if (arg.type === "ref" || arg.type === "range") {
      const r0 = arg.type === "ref" ? arg.ref.row : arg.start.row;
      const r1 = arg.type === "ref" ? arg.ref.row : arg.end.row;
      const c0 = arg.type === "ref" ? arg.ref.col : arg.start.col;
      const c1 = arg.type === "ref" ? arg.ref.col : arg.end.col;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const v = ctx.getCell(toKey({ row: r, col: c }));
          if (isCellError(v)) return v;
          if (typeof v === "boolean") out.push(v);
          else if (typeof v === "number") out.push(v !== 0);
        }
      }
      continue;
    }
    const v = evalScalar(arg, ctx);
    if (isCellError(v)) return v;
    if (v === null) continue;
    const b = toBoolean(v, name);
    if (isCellError(b)) return b;
    out.push(b);
  }
  if (out.length === 0) return cellError("#VALUE!", `${name} found no logical values (numbers or TRUE/FALSE) to test`);
  return out;
}

function evalIferror(args: AstNode[], ctx: EvalContext): CellValue {
  const v = evalScalar(args[0]!, ctx);
  if (!isCellError(v)) return v;
  // Lazy: the fallback is only evaluated when the first argument is an error (any error value).
  return evalScalar(args[1]!, ctx);
}

// ---- conditional aggregates ----

type Matcher = (v: CellValue) => boolean;

function compareOp(op: string, c: number): boolean {
  switch (op) {
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
    case "<>":
      return c !== 0;
    default:
      return c === 0;
  }
}

function numCmp(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function textCmp(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Builds a matcher from an operator and operand. Wildcards (* ? ~) are literal characters.
 * Equality against a number also matches numeric text (as Excel's COUNTIF does); ordering
 * comparisons only look at cells of the same type as the operand.
 */
function operandMatcher(op: string, operand: string | number | boolean): Matcher {
  if (typeof operand === "number") {
    if (op === "=") return (v) => (typeof v === "number" ? v === operand : typeof v === "string" && parseNumericText(v) === operand);
    if (op === "<>") return (v) => !(typeof v === "number" ? v === operand : typeof v === "string" && parseNumericText(v) === operand);
    return (v) => typeof v === "number" && compareOp(op, numCmp(v, operand));
  }
  if (typeof operand === "boolean") {
    if (op === "=") return (v) => v === operand;
    if (op === "<>") return (v) => v !== operand;
    return (v) => typeof v === "boolean" && compareOp(op, numCmp(Number(v), Number(operand)));
  }
  if (operand === "") {
    // "=" matches truly blank cells; "<>" matches every non-blank cell; plain "" matches blank or empty text.
    if (op === "=") return (v) => v === null;
    if (op === "<>") return (v) => v !== null;
    return () => false;
  }
  if (op === "=") return (v) => typeof v === "string" && textCmp(v, operand) === 0;
  if (op === "<>") return (v) => !(typeof v === "string" && textCmp(v, operand) === 0);
  return (v) => typeof v === "string" && compareOp(op, textCmp(v, operand));
}

/** Turns an evaluated criteria argument into a matcher: a number/text/boolean, or text like ">=100" / "<>Closed". */
function buildCriterion(c: Exclude<CellValue, CellError>): Matcher {
  if (c === null) return operandMatcher("=", 0); // a blank criteria cell acts like 0 (as Excel)
  if (typeof c === "number" || typeof c === "boolean") return operandMatcher("=", c);
  let op = "=";
  let rest = c;
  let explicit = false;
  for (const o of ["<=", ">=", "<>", "=", "<", ">"]) {
    if (c.startsWith(o)) {
      op = o;
      rest = c.slice(o.length);
      explicit = true;
      break;
    }
  }
  if (rest === "" && !explicit) return (v) => v === null || v === ""; // criteria "" matches blank or empty text
  const n = rest === "" ? null : parseNumericText(rest);
  if (n !== null) return operandMatcher(op, n);
  const u = rest.trim().toUpperCase();
  if (u === "TRUE" || u === "FALSE") {
    const b = u === "TRUE";
    const asBool = operandMatcher(op, b);
    const asText = operandMatcher(op, rest);
    return op === "<>" ? (v) => asBool(v) && asText(v) : (v) => asBool(v) || asText(v);
  }
  return operandMatcher(op, rest);
}

interface RangeShape {
  r0: number;
  c0: number;
  rows: number;
  cols: number;
}

function rangeShape(node: AstNode, fn: string, what: string): RangeShape | CellError {
  if (node.type !== "ref" && node.type !== "range") {
    return cellError("#VALUE!", `${fn} needs a cell range for the ${what}, for example $A$2:$A$10`);
  }
  const start = node.type === "ref" ? node.ref : node.start;
  const end = node.type === "ref" ? node.ref : node.end;
  return { r0: start.row, c0: start.col, rows: end.row - start.row + 1, cols: end.col - start.col + 1 };
}

function cellAt(s: RangeShape, i: number, ctx: EvalContext): CellValue {
  const r = s.r0 + Math.floor(i / s.cols);
  const c = s.c0 + (i % s.cols);
  return ctx.getCell(toKey({ row: r, col: c }));
}

/** Charges cells against the per-formula scan budget; false when it is exhausted. */
function chargeScan(ctx: EvalContext, cells: number): boolean {
  const scan = ctx.scan;
  if (!scan) return true;
  scan.used += cells;
  return scan.used <= (ctx.maxScanCells ?? DEFAULT_MAX_SCAN_CELLS);
}

const SCAN_LIMIT_ERROR = (fn: string) =>
  cellError("#LIMIT!", `${fn} would scan too many cells in one formula (calculation budget exceeded); use smaller ranges`);

type CondMode = "SUMIF" | "COUNTIF" | "AVERAGEIF" | "SUMIFS" | "COUNTIFS";

/**
 * SUMIF / COUNTIF / AVERAGEIF / SUMIFS / COUNTIFS. `target` is the range summed or averaged (when any).
 * `pairs` are (criteria_range, criteria) argument pairs. All ranges must have the same shape.
 */
function evalConditional(mode: CondMode, args: AstNode[], ctx: EvalContext): CellValue {
  let targetNode: AstNode | undefined;
  let pairNodes: AstNode[];
  if (mode === "SUMIFS") {
    targetNode = args[0];
    pairNodes = args.slice(1);
  } else if (mode === "COUNTIFS") {
    pairNodes = args;
  } else {
    pairNodes = args.slice(0, 2);
    targetNode = args[2] ?? args[0]; // sum_range / average_range default to the criteria range
  }
  if (mode === "COUNTIF") targetNode = undefined;
  const shapes: RangeShape[] = [];
  const matchers: Matcher[] = [];
  let target: RangeShape | undefined;
  if (targetNode !== undefined) {
    const t = rangeShape(targetNode, mode, mode === "AVERAGEIF" ? "average_range" : "sum_range");
    if (isCellError(t)) return t;
    target = t;
  }
  for (let i = 0; i < pairNodes.length; i += 2) {
    const label = pairNodes.length > 2 ? `criteria_range${i / 2 + 1}` : "range";
    const s = rangeShape(pairNodes[i]!, mode, mode === "SUMIFS" || mode === "COUNTIFS" ? label : "range");
    if (isCellError(s)) return s;
    shapes.push(s);
  }
  const first = shapes[0]!;
  for (const s of [...shapes, ...(target ? [target] : [])]) {
    if (s.rows !== first.rows || s.cols !== first.cols) {
      return cellError(
        "#VALUE!",
        `${mode} needs every range to be the same size (${first.rows}x${first.cols} vs ${s.rows}x${s.cols})`,
      );
    }
  }
  // Evaluate the criteria (left to right); an error value in a criteria argument propagates.
  for (let i = 1; i < pairNodes.length; i += 2) {
    const cv = evalScalar(pairNodes[i]!, ctx);
    if (isCellError(cv)) return cv;
    matchers.push(buildCriterion(cv));
  }
  const size = first.rows * first.cols;
  if (!chargeScan(ctx, size * (shapes.length + (target && mode !== "COUNTIF" ? 1 : 0)))) return SCAN_LIMIT_ERROR(mode);
  let count = 0;
  let sum = 0;
  let nums = 0;
  for (let i = 0; i < size; i++) {
    let ok = true;
    for (let k = 0; k < shapes.length; k++) {
      if (!matchers[k]!(cellAt(shapes[k]!, i, ctx))) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    count++;
    if (!target || mode === "COUNTIF" || mode === "COUNTIFS") continue;
    const v = cellAt(target, i, ctx);
    if (isCellError(v)) return v; // an error in a matched row's sum/average cell propagates
    if (typeof v === "number") {
      sum += v;
      nums++;
    }
  }
  switch (mode) {
    case "COUNTIF":
    case "COUNTIFS":
      return count;
    case "AVERAGEIF":
      if (nums === 0) return cellError("#DIV/0!", "AVERAGEIF found no matching numbers to average");
      return numResult(sum / nums);
    default:
      return numResult(sum);
  }
}

// ---- text ----

/** Argument as text (blank -> "", numbers in General format). Errors and ranges propagate. */
function textArg(node: AstNode, ctx: EvalContext): string | CellError {
  const v = evalScalar(node, ctx);
  if (isCellError(v)) return v;
  return toText(v);
}

/** Maps case per character, keeping a character whose case form has a different length (Excel's UPPER("ß") is "ß"). */
function mapCase(s: string, upper: boolean): string {
  let out = "";
  for (const ch of s) {
    const m = upper ? ch.toUpperCase() : ch.toLowerCase();
    out += m.length === ch.length ? m : ch;
  }
  return out;
}

function excelTrim(s: string): string {
  // Excel's TRIM only touches the ASCII space (code 32): it strips the ends and collapses runs.
  return s
    .split(" ")
    .filter((p) => p !== "")
    .join(" ");
}

function evalText(name: "LEN" | "LEFT" | "RIGHT" | "UPPER" | "LOWER" | "TRIM", args: AstNode[], ctx: EvalContext): CellValue {
  const text = textArg(args[0]!, ctx);
  if (isCellError(text)) return text;
  switch (name) {
    case "LEN":
      return text.length;
    case "UPPER":
      return mapCase(text, true);
    case "LOWER":
      return mapCase(text, false);
    case "TRIM":
      return excelTrim(text);
    default: {
      let n = 1;
      if (args[1]) {
        const nv = evalScalar(args[1], ctx);
        if (isCellError(nv)) return nv;
        const x = toNumber(nv);
        if (isCellError(x)) return x;
        if (x < 0) return cellError("#VALUE!", `${name}'s num_chars cannot be negative`);
        n = Math.trunc(x);
      }
      if (n >= text.length) return text;
      return name === "LEFT" ? text.slice(0, n) : text.slice(text.length - n);
    }
  }
}

function evalMedian(args: AstNode[], ctx: EvalContext): CellValue {
  const nums = collectNumbers("MEDIAN", args, ctx);
  if (isCellError(nums)) return nums;
  if (nums.length === 0) return cellError("#NUM!", "MEDIAN found no numbers");
  nums.sort((a, b) => a - b);
  const mid = nums.length >> 1;
  if (nums.length % 2 === 1) return nums[mid]!;
  return numResult((nums[mid - 1]! + nums[mid]!) / 2);
}

function evalCall(name: FunctionName, args: AstNode[], ctx: EvalContext): CellValue {
  if (name === "XLOOKUP") return evalXlookup(args, ctx);
  switch (name) {
    case "ROUND":
      return evalRound(args, ctx);
    case "ABS": {
      const v = evalScalar(args[0]!, ctx);
      if (isCellError(v)) return v;
      const n = toNumber(v);
      if (isCellError(n)) return n;
      return Math.abs(n);
    }
    case "AND":
    case "OR": {
      const l = collectLogicals(name, args, ctx);
      if (isCellError(l)) return l;
      return name === "AND" ? l.every(Boolean) : l.some(Boolean);
    }
    case "NOT": {
      const v = evalScalar(args[0]!, ctx);
      if (isCellError(v)) return v;
      const b = toBoolean(v, "NOT");
      if (isCellError(b)) return b;
      return !b;
    }
    case "IFERROR":
      return evalIferror(args, ctx);
    case "MEDIAN":
      return evalMedian(args, ctx);
    case "SUMIF":
    case "COUNTIF":
    case "AVERAGEIF":
    case "SUMIFS":
    case "COUNTIFS":
      return evalConditional(name, args, ctx);
    case "LEN":
    case "LEFT":
    case "RIGHT":
    case "UPPER":
    case "LOWER":
    case "TRIM":
      return evalText(name, args, ctx);
    default:
      break;
  }
  if (name === "IF") {
    // Lazy: only the chosen branch is evaluated.
    const cond = evalScalar(args[0]!, ctx);
    if (isCellError(cond)) return cond;
    const b = toBoolean(cond);
    if (isCellError(b)) return b;
    if (b) return evalScalar(args[1]!, ctx);
    return args[2] ? evalScalar(args[2], ctx) : false;
  }
  const nums = collectNumbers(name, args, ctx);
  if (isCellError(nums)) return nums;
  switch (name) {
    case "COUNT":
      return nums.length;
    case "SUM": {
      let s = 0;
      for (const n of nums) s += n;
      return numResult(s);
    }
    case "AVERAGE": {
      if (nums.length === 0) return cellError("#DIV/0!", "AVERAGE found no numbers to average");
      let s = 0;
      for (const n of nums) s += n;
      return numResult(s / nums.length);
    }
    case "MIN": {
      if (nums.length === 0) return 0;
      let m = nums[0]!;
      for (const n of nums) if (n < m) m = n;
      return m;
    }
    case "MAX": {
      if (nums.length === 0) return 0;
      let m = nums[0]!;
      for (const n of nums) if (n > m) m = n;
      return m;
    }
  }
}

/** Evaluates a parsed formula to a final cell value (a bare blank reference shows 0, as in Excel). */
export function evaluateAst(ast: AstNode, baseCtx: EvalContext): CellValue {
  const ctx: EvalContext = { ...baseCtx, scan: { used: 0 } }; // fresh scan budget per formula
  const v = evalScalar(ast, ctx);
  if (v === null) return 0;
  if (typeof v === "string" && v.length > ctx.maxStringLength) {
    return cellError("#VALUE!", `Text result is longer than ${ctx.maxStringLength} characters`);
  }
  return v;
}
