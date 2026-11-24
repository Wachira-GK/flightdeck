// EDT-01..10: typing formulas like Excel (point-and-click refs, auto-closing bracket) and the fill handle.
import { describe, expect, it } from "vitest";
import { applyFill, autoFillExtent, canPointAt, closeParens, fillCell, fillTargets, insertPointRef, pointingAllowed, rangeText } from "./grid-helpers";

const size = { rows: 10, cols: 5 };

describe("EDT typing like Excel", () => {
  it("EDT-01 an open formula is closed on entry, like Excel", () => {
    expect(closeParens("=SUM(B2:B4")).toBe("=SUM(B2:B4)");
    expect(closeParens("=IF(A1>1,SUM(B1:B3")).toBe("=IF(A1>1,SUM(B1:B3))");
    expect(closeParens("=SUM(B2:B4)")).toBe("=SUM(B2:B4)");
    expect(closeParens("=A1+1")).toBe("=A1+1");
  });

  it("EDT-02 brackets inside text and non-formulas are left alone", () => {
    expect(closeParens('="a(b"')).toBe('="a(b"');
    expect(closeParens('=IF(A1="(",1,2')).toBe('=IF(A1="(",1,2)');
    expect(closeParens("note (draft")).toBe("note (draft");
    expect(closeParens("=SUM(A1))")).toBe("=SUM(A1))"); // never removes anything
  });

  it("EDT-03 a cell can be pointed at only after =, (, a comma or an operator", () => {
    expect(canPointAt("=", 1)).toBe(true);
    expect(canPointAt("=SUM(", 5)).toBe(true);
    expect(canPointAt("=IF(A1>1,", 9)).toBe(true);
    expect(canPointAt("=B2*", 4)).toBe(true);
    expect(canPointAt("=SUM(B2", 7)).toBe(false);
    expect(canPointAt("SUM(", 4)).toBe(false);
    expect(canPointAt('="a,', 4)).toBe(false); // inside quotes
    expect(canPointAt("=SUM(", 0)).toBe(false);
  });

  it("EDT-04 a pointed block is written top-left first, whichever way it was dragged", () => {
    expect(rangeText({ row: 1, col: 1 }, { row: 1, col: 1 })).toBe("B2");
    expect(rangeText({ row: 1, col: 1 }, { row: 3, col: 1 })).toBe("B2:B4");
    expect(rangeText({ row: 3, col: 2 }, { row: 1, col: 1 })).toBe("B2:C4");
  });

  it("EDT-05 pointing inserts at the caret and the next click replaces it instead of adding another", () => {
    const first = insertPointRef("=SUM(", 5, null, "B2");
    expect(first).toEqual({ draft: "=SUM(B2", start: 5, end: 7 });
    const drag = insertPointRef(first.draft, first.end, first, "B2:B4");
    expect(drag).toEqual({ draft: "=SUM(B2:B4", start: 5, end: 10 });
    const other = insertPointRef(drag.draft, drag.end, drag, "C2");
    expect(other.draft).toBe("=SUM(C2");
    // text after the caret is kept
    expect(insertPointRef("=SUM()", 5, null, "B2").draft).toBe("=SUM(B2)");
  });

  it("EDT-06 pointing stays allowed straight after the reference just pointed at", () => {
    expect(pointingAllowed("=SUM(B2", 7, { start: 5, end: 7 })).toBe(true);
    expect(pointingAllowed("=SUM(B2", 7, null)).toBe(false);
    expect(pointingAllowed("=SUM(B2,", 8, null)).toBe(true);
    expect(pointingAllowed("=SUM(B2x", 8, { start: 5, end: 7 })).toBe(false);
  });
});

describe("EDT fill handle", () => {
  it("EDT-07 fillCell moves formulas, counts up text numbers, copies plain numbers", () => {
    expect(fillCell("=SUM(B2:B4)", 0, 1)).toBe("=SUM(C2:C4)");
    expect(fillCell("=B2*$F$1", 2, 0)).toBe("=B4*$F$1");
    expect(fillCell("Item1", 2, 0)).toBe("Item3");
    expect(fillCell("Q4", 0, -1)).toBe("Q3");
    expect(fillCell("Item007", 1, 0)).toBe("Item008");
    expect(fillCell("42", 3, 0)).toBe("42");
    expect(fillCell("$1,200", 1, 0)).toBe("$1,200");
    expect(fillCell("Total", 1, 0)).toBe("Total");
    expect(fillCell("", 1, 0)).toBe("");
  });

  it("EDT-08 the handle fills along the longer direction, nearest cell first, inside the sheet", () => {
    const down = fillTargets({ row: 1, col: 1 }, { row: 4, col: 2 }, size);
    expect(down.map((s) => [s.pos.row, s.pos.col, s.dRow, s.dCol])).toEqual([
      [2, 1, 1, 0],
      [3, 1, 2, 0],
      [4, 1, 3, 0],
    ]);
    const left = fillTargets({ row: 1, col: 2 }, { row: 1, col: 0 }, size);
    expect(left.map((s) => [s.pos.col, s.dCol])).toEqual([
      [1, -1],
      [0, -2],
    ]);
    expect(fillTargets({ row: 1, col: 1 }, { row: 1, col: 1 }, size)).toEqual([]);
    expect(fillTargets({ row: 8, col: 0 }, { row: 14, col: 0 }, size).map((s) => s.pos.row)).toEqual([9]);
  });

  it("EDT-09 applyFill writes only editable cells and reports the locked ones it skipped", () => {
    const inputs = { B5: "=SUM(B2:B4)" };
    const r = applyFill(inputs, { row: 4, col: 1 }, { row: 4, col: 4 }, size, new Set(["C5", "E5"]));
    expect(r.next).toEqual({ B5: "=SUM(B2:B4)", C5: "=SUM(C2:C4)", E5: "=SUM(E2:E4)" });
    expect(r.filled).toBe(2);
    expect(r.skipped).toBe(1);
    expect(inputs).toEqual({ B5: "=SUM(B2:B4)" }); // the original map is not changed
  });

  it("EDT-10 double-clicking the handle fills down as far as the neighbouring column has data", () => {
    const inputs = { A1: "x", A2: "a", A3: "b", A4: "c", B1: "=A1" };
    expect(autoFillExtent(inputs, { row: 0, col: 1 }, size)).toEqual({ row: 3, col: 1 });
    expect(autoFillExtent({ B1: "=A1" }, { row: 0, col: 1 }, size)).toBeNull();
    expect(autoFillExtent({ A1: "x", A2: "y", C1: "z" }, { row: 0, col: 1 }, size)).toEqual({ row: 1, col: 1 });
  });
});
