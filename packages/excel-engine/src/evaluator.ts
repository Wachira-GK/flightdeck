import type { AstNode, FunctionName } from "./parser";
import { toKey } from "./refs";
import { cellError, isCellError, type CellError, type CellValue } from "./types";
import { compareValues, parseNumericText, toBoolean, toNumber, toText } from "./values";

export interface EvalContext {
  /** Current value of a cell (null when blank). Keys are canonical ("B3"). */
  getCell(key: string): CellValue;
  maxStringLength: number;
}

const RANGE_IN_SCALAR = cellError(
  "#VALUE!",
  "A range like A1:B5 can only be used inside SUM, AVERAGE, MIN, MAX or COUNT",
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

function evalCall(name: FunctionName, args: AstNode[], ctx: EvalContext): CellValue {
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
export function evaluateAst(ast: AstNode, ctx: EvalContext): CellValue {
  const v = evalScalar(ast, ctx);
  if (v === null) return 0;
  if (typeof v === "string" && v.length > ctx.maxStringLength) {
    return cellError("#VALUE!", `Text result is longer than ${ctx.maxStringLength} characters`);
  }
  return v;
}
