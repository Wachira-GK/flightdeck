import { describe, expect, it } from "vitest";
import { createWorkbook, evaluateSheet, formatValue, isCellError, parseFormula, type CellValue } from "../src";
import { code, ev } from "./helpers";

/** A small Kenyan shoe-store price list: codes in A2:A6, names in B2:B6, prices (KES) in C2:C6. */
const TABLE: Record<string, string> = {
  A1: "Code",
  B1: "Product",
  C1: "Price",
  A2: "BT-100",
  B2: "School shoe",
  C2: "2499",
  A3: "BT-200",
  B3: "Sneaker",
  C3: "3999",
  A4: "1050",
  B4: "Numeric code",
  C4: "1500",
  A5: "'2060",
  B5: "Text code",
  C5: "2060",
  A6: "bt-100",
  B6: "Duplicate (lower case)",
  C6: "9999",
};

const msg = (v: CellValue): string => (isCellError(v) ? v.message : "");

describe("XLOOKUP: exact match", () => {
  it("finds a value in a vertical range", () => {
    expect(ev('=XLOOKUP("BT-200",A2:A6,C2:C6)', TABLE)).toBe(3999);
    expect(ev('=XLOOKUP("BT-200",A2:A6,B2:B6)', TABLE)).toBe("Sneaker");
  });

  it("finds a value in a horizontal range", () => {
    const cells = { A1: "Nairobi", B1: "Mombasa", C1: "Kisumu", A2: "120", B2: "85", C2: "60" };
    expect(ev('=XLOOKUP("Kisumu",A1:C1,A2:C2)', cells)).toBe(60);
  });

  it("is case-insensitive for text, like Excel", () => {
    expect(ev('=XLOOKUP("bt-200",A2:A6,C2:C6)', TABLE)).toBe(3999);
    expect(ev('=XLOOKUP("SNEAKER",B2:B6,C2:C6)', TABLE)).toBe(3999);
  });

  it("returns the first match when there are duplicates", () => {
    // "BT-100" (row 2) and "bt-100" (row 6) are equal ignoring case; row 2 wins.
    expect(ev('=XLOOKUP("bt-100",A2:A6,C2:C6)', TABLE)).toBe(2499);
  });

  it("compares numbers numerically", () => {
    expect(ev("=XLOOKUP(1050,A2:A6,C2:C6)", TABLE)).toBe(1500);
    expect(ev("=XLOOKUP(1000+50,A2:A6,C2:C6)", TABLE)).toBe(1500);
    expect(ev("=XLOOKUP(1.05E3,A2:A6,C2:C6)", TABLE)).toBe(1500);
    expect(ev("=XLOOKUP(D1,A2:A6,C2:C6)", { ...TABLE, D1: "1050.0" })).toBe(1500);
  });

  it("does not match a number with numeric text (documented choice, as Excel)", () => {
    // A5 holds the TEXT "2060" (typed with a leading apostrophe); A4 holds the NUMBER 1050.
    expect(code(ev("=XLOOKUP(2060,A2:A6,C2:C6)", TABLE))).toBe("#N/A");
    expect(code(ev('=XLOOKUP("1050",A2:A6,C2:C6)', TABLE))).toBe("#N/A");
    expect(ev('=XLOOKUP("2060",A2:A6,C2:C6)', TABLE)).toBe(2060);
  });

  it("does not match booleans with numbers or text", () => {
    const cells = { A1: "1", A2: "TRUE", A3: "'TRUE", B1: "one", B2: "bool", B3: "text" };
    expect(ev("=XLOOKUP(TRUE,A1:A3,B1:B3)", cells)).toBe("bool");
    expect(ev('=XLOOKUP("true",A1:A3,B1:B3)', cells)).toBe("text");
    expect(ev("=XLOOKUP(1,A1:A3,B1:B3)", cells)).toBe("one");
  });

  it("matches a blank lookup value only to a blank cell", () => {
    const cells = { A1: "0", A2: "", A3: "x", B1: "zero", B2: "blank", B3: "x" };
    expect(ev("=XLOOKUP(D9,A1:A3,B1:B3)", cells)).toBe("blank");
    expect(ev("=XLOOKUP(0,A1:A3,B1:B3)", cells)).toBe("zero");
    expect(code(ev("=XLOOKUP(D9,A1:A1,B1:B1)", cells))).toBe("#N/A");
  });

  it("returns 0 when the matched return cell is blank (as Excel)", () => {
    expect(ev('=XLOOKUP("a",A1:A2,B1:B2)', { A1: "a", A2: "b", B2: "5" })).toBe(0);
  });

  it("accepts a single cell as a 1x1 range", () => {
    expect(ev('=XLOOKUP("a",A1,B1)', { A1: "a", B1: "7" })).toBe(7);
  });

  it("works inside other formulas", () => {
    expect(ev('=XLOOKUP("BT-100",A2:A6,C2:C6)*2', TABLE)).toBe(4998);
    expect(ev('=IF(XLOOKUP("BT-100",A2:A6,C2:C6)>3000,"premium","value")', TABLE)).toBe("value");
    expect(ev('=SUM(XLOOKUP("BT-100",A2:A6,C2:C6),1)', TABLE)).toBe(2500);
    expect(ev('=XLOOKUP("BT-200",A2:A6,B2:B6)&" KES"', TABLE)).toBe("Sneaker KES");
  });

  it("accepts lower-case function names", () => {
    expect(ev('=xlookup("BT-200",a2:a6,c2:c6)', TABLE)).toBe(3999);
  });
});

describe("XLOOKUP: not found", () => {
  it("returns #N/A without if_not_found", () => {
    const v = ev('=XLOOKUP("BT-999",A2:A6,C2:C6)', TABLE);
    expect(code(v)).toBe("#N/A");
    expect(msg(v)).toMatch(/no exact match/);
    expect(formatValue(v)).toBe("#N/A");
  });

  it("returns if_not_found when given", () => {
    expect(ev('=XLOOKUP("BT-999",A2:A6,C2:C6,"Not listed")', TABLE)).toBe("Not listed");
    expect(ev('=XLOOKUP("BT-999",A2:A6,C2:C6,0)', TABLE)).toBe(0);
    expect(ev('=XLOOKUP("BT-999",A2:A6,C2:C6,D1*2)', { ...TABLE, D1: "21" })).toBe(42);
  });

  it("evaluates if_not_found lazily", () => {
    // Found: the #DIV/0! fallback is never evaluated.
    expect(ev('=XLOOKUP("BT-100",A2:A6,C2:C6,1/0)', TABLE)).toBe(2499);
    expect(ev('=XLOOKUP("BT-100",A2:A6,C2:C6,D1)', { ...TABLE, D1: "=1/0" })).toBe(2499);
    // Not found: the fallback is evaluated, and its error is the result.
    expect(code(ev('=XLOOKUP("BT-999",A2:A6,C2:C6,1/0)', TABLE))).toBe("#DIV/0!");
  });

  it("a blank if_not_found cell gives 0", () => {
    expect(ev('=XLOOKUP("zz",A2:A6,C2:C6,D1)', TABLE)).toBe(0);
  });

  it("#N/A propagates to dependent cells", () => {
    const wb = createWorkbook();
    wb.setCells({ ...TABLE, E1: '=XLOOKUP("nope",A2:A6,C2:C6)', E2: "=E1*1.16", E3: "=SUM(E1:E2)", E4: "=COUNT(E1:E2)" });
    expect(code(wb.getValue("E2"))).toBe("#N/A");
    expect(code(wb.getValue("E3"))).toBe("#N/A");
    expect(wb.getValue("E4")).toBe(0);
  });
});

describe("XLOOKUP: argument errors", () => {
  it("mismatched sizes are #VALUE!", () => {
    const v = ev('=XLOOKUP("BT-100",A2:A6,C2:C5)', TABLE);
    expect(code(v)).toBe("#VALUE!");
    expect(msg(v)).toMatch(/same size/);
  });

  it("same length but different orientation is #VALUE!", () => {
    expect(code(ev('=XLOOKUP("a",A1:A3,B1:D1)', { A1: "a" }))).toBe("#VALUE!");
  });

  it("2-D ranges are #VALUE!", () => {
    const v1 = ev('=XLOOKUP("BT-100",A2:B6,C2:D6)', TABLE);
    expect(code(v1)).toBe("#VALUE!");
    expect(msg(v1)).toMatch(/single row or a single column/);
    expect(code(ev('=XLOOKUP("BT-100",A2:A6,B2:C6)', TABLE))).toBe("#VALUE!");
  });

  it("non-range arrays are #VALUE!", () => {
    expect(code(ev('=XLOOKUP("a","a",B1:B1)', { B1: "1" }))).toBe("#VALUE!");
    expect(code(ev('=XLOOKUP("a",A1:A1,5)', { A1: "a" }))).toBe("#VALUE!");
  });

  it("a range as lookup_value is #VALUE!", () => {
    expect(code(ev("=XLOOKUP(A2:A3,A2:A6,C2:C6)", TABLE))).toBe("#VALUE!");
  });

  it("match_mode / search_mode arguments are #VALUE! with an exact-match-only message", () => {
    for (const f of [
      '=XLOOKUP("BT-100",A2:A6,C2:C6,"none",0)',
      '=XLOOKUP("BT-100",A2:A6,C2:C6,"none",-1)',
      '=XLOOKUP("BT-100",A2:A6,C2:C6,"none",0,1)',
    ]) {
      const v = ev(f, TABLE);
      expect(code(v)).toBe("#VALUE!");
      expect(msg(v)).toMatch(/exact match only/);
    }
  });

  it("wrong arity is #ERROR! (Excel refuses the formula)", () => {
    expect(code(ev('=XLOOKUP("a",A1:A2)'))).toBe("#ERROR!");
    expect(code(ev('=XLOOKUP("a",A1:A2,B1:B2,1,0,1,1)'))).toBe("#ERROR!");
    expect(code(ev('=XLOOKUP("a",A1:A2,B1:B2,,0)'))).toBe("#ERROR!");
  });
});

describe("XLOOKUP: errors in arrays", () => {
  const cells = { A1: "=1/0", A2: "x", A3: "y", B1: "1", B2: "=1/0", B3: "3" };
  it("skips errors in lookup_array", () => {
    expect(ev('=XLOOKUP("y",A1:A3,B1:B3)', cells)).toBe(3);
    expect(code(ev('=XLOOKUP("z",A1:A3,B1:B3)', cells))).toBe("#N/A");
  });
  it("returns an error found in the matched return cell", () => {
    expect(code(ev('=XLOOKUP("x",A1:A3,B1:B3)', cells))).toBe("#DIV/0!");
  });
  it("ignores errors in return_array cells that are not matched", () => {
    expect(ev('=XLOOKUP("y",A1:A3,B1:B3)', cells)).toBe(3);
  });
  it("propagates an error in lookup_value", () => {
    expect(code(ev("=XLOOKUP(1/0,A1:A3,B1:B3)", cells))).toBe("#DIV/0!");
    expect(code(ev("=XLOOKUP(A1,A1:A3,B1:B3)", cells))).toBe("#DIV/0!");
  });
});

describe("XLOOKUP: references and recalculation", () => {
  const PRICES = { A2: "BT-100", A3: "BT-200", A4: "BT-300", B2: "2499", B3: "3999", B4: "5499", D2: "BT-200", D3: "BT-300" };

  it("absolute and mixed references work", () => {
    const sheet = evaluateSheet({
      ...PRICES,
      E2: "=XLOOKUP(D2,$A$2:$A$4,$B$2:$B$4)",
      E3: "=XLOOKUP(D3,A$2:A$4,$B2:$B4)",
    });
    expect(sheet.E2).toBe(3999);
    expect(sheet.E3).toBe(5499);
  });

  it("depends on every cell of both ranges", () => {
    const wb = createWorkbook();
    wb.setCells({ ...PRICES, E2: "=XLOOKUP(D2,$A$2:$A$4,$B$2:$B$4)" });
    expect(wb.precedentsOf("E2")).toEqual(["A2", "B2", "D2", "A3", "B3", "A4", "B4"]); // row-major
    for (const k of ["A2", "A4", "B2", "B4", "D2"]) expect(wb.dependentsOf(k)).toContain("E2");
    expect(wb.stats().edges).toBe(7);
  });

  it("recalculates when the lookup table changes", () => {
    const wb = createWorkbook();
    wb.setCells({ ...PRICES, E2: "=XLOOKUP(D2,$A$2:$A$4,$B$2:$B$4)", F2: "=E2*3" });
    expect(wb.getValue("E2")).toBe(3999);
    // Price change in the return range.
    expect(wb.setCell("B3", "4200").recalculated).toEqual(["E2", "F2"]);
    expect(wb.getValue("E2")).toBe(4200);
    expect(wb.getValue("F2")).toBe(12600);
    // Code renamed in the lookup range: no longer found.
    wb.setCell("A3", "BT-201");
    expect(code(wb.getValue("E2"))).toBe("#N/A");
    // The lookup value changes to the new code.
    wb.setCell("D2", "bt-201");
    expect(wb.getValue("E2")).toBe(4200);
    // A row that was never matched still triggers recalculation (same, deterministic value).
    expect(wb.setCell("B4", "1").recalculated).toContain("E2");
    expect(wb.getValue("E2")).toBe(4200);
  });

  it("a lookup over its own cell is circular", () => {
    expect(code(evaluateSheet({ A1: '=XLOOKUP("x",A1:A3,B1:B3)', A2: "x", B2: "1" }).A1 ?? null)).toBe("#CIRC!");
  });

  it("parses to a call node with range arguments", () => {
    const ast = parseFormula("=XLOOKUP(D2,$A$2:$A$4,$B$2:$B$4,\"n/a\")");
    expect(ast.type).toBe("call");
    if (ast.type === "call") {
      expect(ast.name).toBe("XLOOKUP");
      expect(ast.args.map((a) => a.type)).toEqual(["ref", "range", "range", "string"]);
    }
  });
});
