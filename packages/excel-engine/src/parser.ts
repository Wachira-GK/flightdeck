import { tokenize, type Token } from "./lexer";
import { parseCellRef, toKey, type CellRefParts } from "./refs";
import { DEFAULT_LIMITS, LimitError, ParseError, type Limits } from "./types";

/** The v0 function allow-list (CT5). Anything else is `#NAME?`. */
export const SUPPORTED_FUNCTIONS = ["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "IF"] as const;
export type FunctionName = (typeof SUPPORTED_FUNCTIONS)[number];

const FUNCTION_ARITY: Record<FunctionName, readonly [number, number]> = {
  SUM: [1, 255],
  AVERAGE: [1, 255],
  MIN: [1, 255],
  MAX: [1, 255],
  COUNT: [1, 255],
  IF: [2, 3],
};

export function isSupportedFunction(name: string): name is FunctionName {
  return (SUPPORTED_FUNCTIONS as readonly string[]).includes(name);
}

export type BinaryOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

export interface RefNode {
  type: "ref";
  ref: CellRefParts;
  /** Canonical key, e.g. "B3". */
  key: string;
}

export interface RangeNode {
  type: "range";
  /** Normalised top-left corner. */
  start: CellRefParts;
  /** Normalised bottom-right corner. */
  end: CellRefParts;
}

export type AstNode =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | RefNode
  | RangeNode
  | { type: "unary"; op: "-" | "+"; operand: AstNode }
  | { type: "percent"; operand: AstNode }
  | { type: "binary"; op: BinaryOp; left: AstNode; right: AstNode }
  | { type: "call"; name: FunctionName; args: AstNode[] };

export interface ParseOptions {
  limits?: Partial<Pick<Limits, "maxAstDepth" | "maxFormulaLength">>;
}

const COMPARISON_OPS = new Set(["=", "<>", "<", ">", "<=", ">="]);

class Parser {
  private i = 0;
  private nesting = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly maxDepth: number,
  ) {}

  private peek(): Token {
    return this.tokens[this.i]!;
  }

  private next(): Token {
    const t = this.tokens[this.i]!;
    if (t.type !== "eof") this.i++;
    return t;
  }

  private isOp(...ops: string[]): boolean {
    const t = this.peek();
    return t.type === "op" && ops.includes(t.text);
  }

  private enter(pos: number): void {
    this.nesting++;
    if (this.nesting > this.maxDepth) {
      throw new LimitError(
        "astDepth",
        `Formula is nested more than ${this.maxDepth} levels deep (near position ${pos + 1})`,
      );
    }
  }

  private leave(): void {
    this.nesting--;
  }

  parseFormula(): AstNode {
    if (this.peek().type === "eof") throw new ParseError("The formula is empty", "#ERROR!", this.peek().pos);
    const node = this.parseComparison();
    const t = this.peek();
    if (t.type !== "eof") throw this.unexpected(t);
    return node;
  }

  private unexpected(t: Token): ParseError {
    if (t.type === "eof") return new ParseError("The formula ends unexpectedly", "#ERROR!", t.pos);
    if (t.type === "rparen") return new ParseError(`Unexpected ")" at position ${t.pos + 1}`, "#ERROR!", t.pos);
    return new ParseError(`Unexpected "${t.text}" at position ${t.pos + 1}`, "#ERROR!", t.pos);
  }

  private parseComparison(): AstNode {
    let left = this.parseConcat();
    while (this.peek().type === "op" && COMPARISON_OPS.has(this.peek().text)) {
      const op = this.next().text as BinaryOp;
      const right = this.parseConcat();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseConcat(): AstNode {
    let left = this.parseAdditive();
    while (this.isOp("&")) {
      this.next();
      const right = this.parseAdditive();
      left = { type: "binary", op: "&", left, right };
    }
    return left;
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    while (this.isOp("+", "-")) {
      const op = this.next().text as BinaryOp;
      const right = this.parseMultiplicative();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parsePower();
    while (this.isOp("*", "/")) {
      const op = this.next().text as BinaryOp;
      const right = this.parsePower();
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  /** Excel's ^ is left-associative: =2^3^2 is 64. */
  private parsePower(): AstNode {
    let left = this.parsePercent();
    while (this.isOp("^")) {
      this.next();
      const right = this.parsePercent();
      left = { type: "binary", op: "^", left, right };
    }
    return left;
  }

  private parsePercent(): AstNode {
    let node = this.parseUnary();
    while (this.isOp("%")) {
      this.next();
      node = { type: "percent", operand: node };
    }
    return node;
  }

  /** Unary minus binds tighter than ^ in Excel: =-2^2 is 4. */
  private parseUnary(): AstNode {
    if (this.isOp("-", "+")) {
      const t = this.next();
      this.enter(t.pos);
      const operand = this.parseUnary();
      this.leave();
      return { type: "unary", op: t.text as "-" | "+", operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    const t = this.next();
    switch (t.type) {
      case "number":
        return { type: "number", value: t.num! };
      case "string":
        return { type: "string", value: t.text };
      case "boolean":
        return { type: "boolean", value: t.num === 1 };
      case "ref": {
        const ref = parseCellRef(t.text)!;
        if (this.peek().type === "colon") {
          this.next();
          const endTok = this.next();
          if (endTok.type !== "ref") {
            throw new ParseError(
              `A range needs a cell reference after ":" (for example A1:B5), at position ${endTok.pos + 1}`,
              "#ERROR!",
              endTok.pos,
            );
          }
          const end = parseCellRef(endTok.text)!;
          return {
            type: "range",
            start: { row: Math.min(ref.row, end.row), col: Math.min(ref.col, end.col), absRow: ref.absRow, absCol: ref.absCol },
            end: { row: Math.max(ref.row, end.row), col: Math.max(ref.col, end.col), absRow: end.absRow, absCol: end.absCol },
          };
        }
        return { type: "ref", ref, key: toKey(ref) };
      }
      case "func":
        return this.parseCall(t);
      case "lparen": {
        this.enter(t.pos);
        const inner = this.parseComparison();
        this.leave();
        const close = this.next();
        if (close.type !== "rparen") {
          throw new ParseError(`Missing ")" for the "(" at position ${t.pos + 1}`, "#ERROR!", close.pos);
        }
        return inner;
      }
      case "name": {
        if (this.peek().type === "colon") {
          throw new ParseError(
            `Whole-column or whole-row references like ${t.text}:${t.text} are not supported; use a range such as A1:A10`,
            "#NAME?",
            t.pos,
          );
        }
        throw new ParseError(
          `"${t.text}" is not a recognised name. Text needs double quotes, for example "${t.text}"`,
          "#NAME?",
          t.pos,
        );
      }
      default:
        throw this.unexpected(t);
    }
  }

  private parseCall(t: Token): AstNode {
    const name = t.text;
    if (!isSupportedFunction(name)) {
      throw new ParseError(
        `${name} is not available in this simulator. Supported functions: ${SUPPORTED_FUNCTIONS.join(", ")}`,
        "#NAME?",
        t.pos,
      );
    }
    this.next(); // "("
    this.enter(t.pos);
    const args: AstNode[] = [];
    if (this.peek().type !== "rparen") {
      for (;;) {
        const p = this.peek();
        if (p.type === "comma" || p.type === "rparen") {
          throw new ParseError(`Empty argument in ${name} at position ${p.pos + 1}`, "#ERROR!", p.pos);
        }
        args.push(this.parseComparison());
        if (this.peek().type === "comma") {
          this.next();
          continue;
        }
        break;
      }
    }
    const close = this.next();
    if (close.type !== "rparen") {
      if (close.type === "eof") throw new ParseError(`Missing ")" to close ${name}(`, "#ERROR!", close.pos);
      throw this.unexpected(close);
    }
    this.leave();
    const [min, max] = FUNCTION_ARITY[name];
    if (args.length < min || args.length > max) {
      const want = min === max ? `${min}` : max === 255 ? `at least ${min}` : `${min} or ${max}`;
      throw new ParseError(`${name} needs ${want} argument${want === "1" ? "" : "s"}, got ${args.length}`, "#ERROR!", t.pos);
    }
    return { type: "call", name, args };
  }
}

/** Depth of an AST (a single literal has depth 1). */
export function astDepth(node: AstNode): number {
  switch (node.type) {
    case "unary":
    case "percent":
      return 1 + astDepth(node.operand);
    case "binary":
      return 1 + Math.max(astDepth(node.left), astDepth(node.right));
    case "call": {
      let d = 0;
      for (const a of node.args) d = Math.max(d, astDepth(a));
      return 1 + d;
    }
    default:
      return 1;
  }
}

/**
 * Parses a formula into an AST. Accepts the text with or without the leading "=".
 * Throws ParseError (#ERROR! / #NAME?) or LimitError (#LIMIT!). Never evaluates anything.
 */
export function parseFormula(formula: string, options: ParseOptions = {}): AstNode {
  const maxLen = options.limits?.maxFormulaLength ?? DEFAULT_LIMITS.maxFormulaLength;
  const maxDepth = options.limits?.maxAstDepth ?? DEFAULT_LIMITS.maxAstDepth;
  if (typeof formula !== "string") throw new ParseError("Formula must be text", "#ERROR!", 0);
  const text = formula.startsWith("=") ? formula : `=${formula}`;
  if (text.length > maxLen) {
    throw new LimitError("formulaLength", `Formula is ${text.length} characters; the limit is ${maxLen}`);
  }
  const tokens = tokenize(text.slice(1), 1);
  const ast = new Parser(tokens, maxDepth).parseFormula();
  const depth = astDepth(ast);
  if (depth > maxDepth) {
    throw new LimitError(
      "astDepth",
      `Formula is ${depth} levels deep; the limit is ${maxDepth}. Long chains like A1+A2+A3+... can use SUM instead`,
    );
  }
  return ast;
}

/** Function names used anywhere in an AST, in first-seen order. */
export function collectFunctions(node: AstNode, out: FunctionName[] = []): FunctionName[] {
  switch (node.type) {
    case "call":
      if (!out.includes(node.name)) out.push(node.name);
      for (const a of node.args) collectFunctions(a, out);
      break;
    case "unary":
    case "percent":
      collectFunctions(node.operand, out);
      break;
    case "binary":
      collectFunctions(node.left, out);
      collectFunctions(node.right, out);
      break;
    default:
      break;
  }
  return out;
}

/** Every cell/range reference in an AST. */
export function collectReferences(node: AstNode, out: (RefNode | RangeNode)[] = []): (RefNode | RangeNode)[] {
  switch (node.type) {
    case "ref":
    case "range":
      out.push(node);
      break;
    case "call":
      for (const a of node.args) collectReferences(a, out);
      break;
    case "unary":
    case "percent":
      collectReferences(node.operand, out);
      break;
    case "binary":
      collectReferences(node.left, out);
      collectReferences(node.right, out);
      break;
    default:
      break;
  }
  return out;
}
