import { columnToLetters, lettersToColumn } from "./refs";

const REF_AT = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})/;
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_.$]/.test(c);

/**
 * Moves the relative cell references of a formula by (dRow, dCol), exactly like Excel's fill handle and copy/paste:
 * `B2` becomes `B3` one row down, `$B2` keeps its column, `B$2` keeps its row, `$B$2` never moves.
 * A reference pushed off the top or left edge becomes `#REF!` (as in Excel). Text inside "quotes", function names
 * such as LOG10( and anything that is not a plain cell reference are left alone. Pure string work; never evaluates.
 * Input that does not start with "=" is returned unchanged.
 */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (!formula.startsWith("=") || (dRow === 0 && dCol === 0)) return formula;
  let out = "=";
  let i = 1;
  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === '"') {
      // String literal: copy through the closing quote ("" is an escaped quote).
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') j += 2;
          else break;
        } else j += 1;
      }
      out += formula.slice(i, Math.min(j + 1, formula.length));
      i = Math.min(j + 1, formula.length);
      continue;
    }
    const m = REF_AT.exec(formula.slice(i));
    const before = formula[i - 1];
    const after = m ? formula[i + m[0].length] : undefined;
    if (m && !isWordChar(before) && !isWordChar(after) && after !== "(") {
      const col = lettersToColumn(m[2]!) + (m[1] === "$" ? 0 : dCol);
      const row = Number(m[4]) - 1 + (m[3] === "$" ? 0 : dRow);
      out += col < 0 || row < 0 ? "#REF!" : `${m[1]}${columnToLetters(col)}${m[3]}${row + 1}`;
      i += m[0].length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
