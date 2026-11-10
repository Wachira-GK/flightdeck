import { parseCellRef } from "./refs";
import { ParseError } from "./types";

export type TokenType =
  | "number"
  | "string"
  | "boolean"
  | "ref"
  | "func"
  | "name"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "colon"
  | "eof";

export interface Token {
  type: TokenType;
  /** Raw text for refs/names/ops; upper-cased name for funcs; decoded text for strings. */
  text: string;
  /** Numeric value for number tokens, boolean value encoded as 1/0 for booleans. */
  num?: number;
  pos: number;
}

const OPERATOR_CHARS = new Set(["+", "-", "*", "/", "^", "&", "=", "<", ">", "%"]);

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

function isWordStart(c: string | undefined): boolean {
  return c !== undefined && ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_" || c === "$");
}

function isWordChar(c: string | undefined): boolean {
  return isWordStart(c) || isDigit(c) || c === ".";
}

function isSpace(c: string | undefined): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

const UNSUPPORTED_HINTS: Record<string, string> = {
  "!": "Sheet references (Sheet1!A1) are not supported in this simulator.",
  "#": "Error literals such as #N/A are not supported in formulas.",
  "{": "Array constants {1,2,3} are not supported in this simulator.",
  "}": "Array constants {1,2,3} are not supported in this simulator.",
  "[": "Structured/table references are not supported in this simulator.",
  "]": "Structured/table references are not supported in this simulator.",
  ";": "Use a comma (,) to separate function arguments.",
  "@": "The @ operator is not supported in this simulator.",
  "'": "Quoted sheet names are not supported in this simulator.",
};

/**
 * Tokenises a formula body (without the leading "="). Pure string scanning; never evaluates code.
 */
export function tokenize(src: string, offset = 0): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    const start = i;
    const pos = start + offset;

    // Numbers: 12, 1.5, .5, 1e3, 2.5E-2
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      while (isDigit(src[i])) i++;
      if (src[i] === ".") {
        i++;
        while (isDigit(src[i])) i++;
      }
      if (src[i] === "e" || src[i] === "E") {
        let j = i + 1;
        if (src[j] === "+" || src[j] === "-") j++;
        if (isDigit(src[j])) {
          i = j;
          while (isDigit(src[i])) i++;
        }
      }
      if (isWordStart(src[i]) || src[i] === ".") {
        throw new ParseError(`Unexpected "${src[i]}" after the number at position ${pos + 1}`, "#ERROR!", pos);
      }
      const text = src.slice(start, i);
      tokens.push({ type: "number", text, num: Number(text), pos });
      continue;
    }

    // Strings: "text" with "" as an escaped quote.
    if (c === '"') {
      i++;
      let value = "";
      for (;;) {
        if (i >= n) throw new ParseError("A text value is missing its closing quote (\")", "#ERROR!", pos);
        const ch = src[i]!;
        if (ch === '"') {
          if (src[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += ch;
        i++;
      }
      tokens.push({ type: "string", text: value, pos });
      continue;
    }

    // Words: cell refs (A1, $B$2), function names (SUM), booleans, other names.
    if (isWordStart(c)) {
      while (isWordChar(src[i])) i++;
      const word = src.slice(start, i);
      let j = i;
      while (isSpace(src[j])) j++;
      if (src[j] === "(") {
        if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(word)) {
          throw new ParseError(`"${word}" is not a valid function name`, "#NAME?", pos);
        }
        tokens.push({ type: "func", text: word.toUpperCase(), pos });
        continue;
      }
      if (parseCellRef(word)) {
        tokens.push({ type: "ref", text: word, pos });
        continue;
      }
      const upper = word.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") {
        tokens.push({ type: "boolean", text: upper, num: upper === "TRUE" ? 1 : 0, pos });
        continue;
      }
      tokens.push({ type: "name", text: word, pos });
      continue;
    }

    if (c === "(") {
      tokens.push({ type: "lparen", text: c, pos });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", text: c, pos });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "comma", text: c, pos });
      i++;
      continue;
    }
    if (c === ":") {
      tokens.push({ type: "colon", text: c, pos });
      i++;
      continue;
    }
    if (c !== undefined && OPERATOR_CHARS.has(c)) {
      const two = src.slice(i, i + 2);
      if (two === "<>" || two === "<=" || two === ">=") {
        tokens.push({ type: "op", text: two, pos });
        i += 2;
      } else {
        tokens.push({ type: "op", text: c, pos });
        i++;
      }
      continue;
    }

    const hint = c !== undefined ? UNSUPPORTED_HINTS[c] : undefined;
    throw new ParseError(hint ?? `Unsupported character "${c}" at position ${pos + 1}`, "#NAME?", pos);
  }
  tokens.push({ type: "eof", text: "", pos: n + offset });
  return tokens;
}
