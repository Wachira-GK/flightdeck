// SHF-01..06: shiftFormula (fill handle / copy semantics).
import { describe, expect, it } from "vitest";
import { shiftFormula } from "../src";

describe("SHF shiftFormula", () => {
  it("SHF-01 relative references move with the fill", () => {
    expect(shiftFormula("=SUM(B2:B4)", 0, 1)).toBe("=SUM(C2:C4)");
    expect(shiftFormula("=SUM(B2:B4)", 1, 0)).toBe("=SUM(B3:B5)");
    expect(shiftFormula("=B2*C2", 3, 2)).toBe("=D5*E5");
    expect(shiftFormula("=b2+1", 1, 0)).toBe("=B3+1"); // like Excel, column letters come out upper-case
  });

  it("SHF-02 dollar signs pin the column, the row, or both", () => {
    expect(shiftFormula("=$B2+B$2+$B$2", 1, 1)).toBe("=$B3+C$2+$B$2");
    expect(shiftFormula("=SUM($B$2:B4)", 2, 0)).toBe("=SUM($B$2:B6)");
  });

  it("SHF-03 a reference pushed off the top or left edge becomes #REF!", () => {
    expect(shiftFormula("=A1+B2", -1, 0)).toBe("=#REF!+B1");
    expect(shiftFormula("=A1+B2", 0, -1)).toBe("=#REF!+A2");
    expect(shiftFormula("=$A$1+A1", -1, -1)).toBe("=$A$1+#REF!");
  });

  it("SHF-04 text in quotes, function names and non-references are left alone", () => {
    expect(shiftFormula('=IF(A1="A1","B2",LOG10(A1))', 1, 0)).toBe('=IF(A2="A1","B2",LOG10(A2))');
    expect(shiftFormula('="say ""A1"" now"&A1', 1, 0)).toBe('="say ""A1"" now"&A2');
    expect(shiftFormula("=ROUND(B2,2)", 1, 0)).toBe("=ROUND(B3,2)");
  });

  it("SHF-05 plain values and zero moves are returned unchanged", () => {
    expect(shiftFormula("42", 1, 1)).toBe("42");
    expect(shiftFormula("Item1", 1, 0)).toBe("Item1");
    expect(shiftFormula("=B2", 0, 0)).toBe("=B2");
  });

  it("SHF-06 multi-letter columns carry correctly", () => {
    expect(shiftFormula("=Z1", 0, 1)).toBe("=AA1");
    expect(shiftFormula("=AB10", 1, -1)).toBe("=AA11");
  });
});
