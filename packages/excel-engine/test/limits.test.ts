import { describe, expect, it } from "vitest";
import { createWorkbook, DEFAULT_LIMITS, evaluateSheet, LimitError, parseFormula, resolveLimits } from "../src";
import { code } from "./helpers";

function limitMessage(v: unknown): string {
  return (v as { message: string }).message;
}

describe("defaults", () => {
  it("match the threat model (CT5)", () => {
    expect(DEFAULT_LIMITS).toMatchObject({
      maxRows: 100,
      maxCols: 30,
      maxCells: 500,
      maxAstDepth: 30,
      maxEdges: 5000,
      maxFormulaLength: 1024,
    });
  });
  it("are configurable and validated", () => {
    expect(resolveLimits({ maxCells: 10 }).maxCells).toBe(10);
    expect(() => resolveLimits({ maxCells: 0 })).toThrow(RangeError);
    expect(() => resolveLimits({ maxRows: 1.5 })).toThrow(RangeError);
  });
});

describe("grid limit (100 x 30, A..AD)", () => {
  it("allows the corner cell AD100", () => {
    const wb = createWorkbook();
    wb.setCell("AD100", "1");
    expect(wb.getValue("AD100")).toBe(1);
  });
  it("throws LimitError for cells outside the grid", () => {
    const wb = createWorkbook();
    expect(() => wb.setCell("AE1", "1")).toThrow(LimitError);
    try {
      wb.setCell("A101", "1");
    } catch (e) {
      expect(e).toBeInstanceOf(LimitError);
      expect((e as LimitError).limit).toBe("grid");
      expect((e as LimitError).code).toBe("#LIMIT!");
    }
  });
  it("formulas referencing outside the grid are #LIMIT!", () => {
    const wb = createWorkbook();
    wb.setCell("A1", "=SUM(A1:AE5)");
    expect(code(wb.getValue("A1"))).toBe("#LIMIT!");
  });
  it("respects a custom grid", () => {
    const wb = createWorkbook({ maxRows: 5, maxCols: 3 });
    expect(() => wb.setCell("D1", "1")).toThrow(LimitError);
    wb.setCell("C5", "=A6");
    expect(code(wb.getValue("C5"))).toBe("#LIMIT!");
  });
});

describe("non-empty cell limit (500)", () => {
  it("throws LimitError for the 501st cell, and evaluateSheet marks it #LIMIT!", () => {
    const wb = createWorkbook();
    const cells: Record<string, string> = {};
    let n = 0;
    for (let r = 1; r <= 100 && n < 500; r++) {
      for (let c = 0; c < 5 && n < 500; c++, n++) cells[`${"ABCDE"[c]}${r}`] = "1";
    }
    wb.setCells(cells);
    expect(wb.stats().cells).toBe(500);
    expect(() => wb.setCell("Z1", "1")).toThrow(LimitError);
    // Overwriting an existing cell is still fine.
    wb.setCell("A1", "2");
    // Clearing frees a slot.
    wb.setCell("A1", "");
    wb.setCell("Z1", "1");
    expect(wb.getValue("Z1")).toBe(1);

    // Cells are accepted in row-major order, so the last cell (Z100) is the one over the limit.
    const out = evaluateSheet({ ...cells, Z100: "=SUM(A1:E100)" });
    expect(code(out.Z100!)).toBe("#LIMIT!");
    expect(out.A1).toBe(1);
  });
  it("a batch that breaches the limit keeps the accepted cells consistent", () => {
    const wb = createWorkbook({ maxCells: 3 });
    expect(() => wb.setCells({ A1: "1", A2: "=A1+1", A3: "=A2+1", A4: "4" })).toThrow(LimitError);
    expect(wb.getValue("A3")).toBe(3);
  });
});

describe("AST depth limit (30)", () => {
  it("parseFormula throws LimitError", () => {
    expect(() => parseFormula("=" + "(".repeat(40) + "1" + ")".repeat(40))).toThrow(LimitError);
  });
  it("the cell shows #LIMIT!, never a crash", () => {
    const wb = createWorkbook();
    wb.setCell("A1", "=" + "IF(TRUE,".repeat(31) + "1" + ")".repeat(31));
    expect(code(wb.getValue("A1"))).toBe("#LIMIT!");
    wb.setCell("A2", "=" + "-".repeat(1000) + "1");
    expect(code(wb.getValue("A2"))).toBe("#LIMIT!");
  });
  it("is configurable", () => {
    const wb = createWorkbook({ maxAstDepth: 3 });
    wb.setCell("A1", "=1+2");
    wb.setCell("A2", "=1+2+3+4");
    expect(wb.getValue("A1")).toBe(3);
    expect(code(wb.getValue("A2"))).toBe("#LIMIT!");
  });
});

describe("dependency edge limit (5000)", () => {
  it("a formula that would exceed the edge budget is #LIMIT!", () => {
    const wb = createWorkbook();
    wb.setCell("AD1", "=SUM(A1:AC100)"); // 2900 edges
    wb.setCell("AD2", "=SUM(A1:T100)"); // 2000 edges -> 4900 total
    expect(wb.stats().edges).toBe(4900);
    wb.setCell("AD3", "=SUM(A1:A101)"); // out of grid, separate check
    wb.setCell("AD4", "=SUM(A1:B100)"); // +200 -> over 5000
    expect(code(wb.getValue("AD4"))).toBe("#LIMIT!");
    expect(limitMessage(wb.getValue("AD4"))).toMatch(/5000/);
    expect(wb.stats().edges).toBe(4900);
    wb.setCell("AD5", "=SUM(A1:A100)"); // exactly 5000
    expect(wb.stats().edges).toBe(5000);
    expect(wb.getValue("AD5")).toBe(0);
  });
  it("duplicate references count once", () => {
    const wb = createWorkbook({ maxEdges: 3 });
    wb.setCell("B1", "=A1+A1+SUM(A1:A3)+A2");
    expect(wb.getValue("B1")).toBe(0);
    expect(wb.stats().edges).toBe(3);
  });
  it("is configurable", () => {
    const wb = createWorkbook({ maxEdges: 2 });
    wb.setCell("B1", "=SUM(A1:A3)");
    expect(code(wb.getValue("B1"))).toBe("#LIMIT!");
  });
  it("many huge ranges in one formula stay fast", () => {
    const f = "=" + Array(73).fill("SUM(A1:AC100)").join("+");
    expect(f.length).toBeLessThanOrEqual(1024);
    const t0 = performance.now();
    const wb = createWorkbook({ maxAstDepth: 200 });
    wb.setCell("AD1", f);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(wb.getValue("AD1")).toBe(0);
    expect(wb.stats().edges).toBe(2900);
  });
});

describe("formula length limit (1024)", () => {
  it("1024 characters is allowed, 1025 is #LIMIT!", () => {
    const ok = "=" + "1".repeat(1023);
    const tooLong = "=" + "1".repeat(1024);
    expect(() => parseFormula(ok)).not.toThrow();
    expect(() => parseFormula(tooLong)).toThrow(LimitError);
    const wb = createWorkbook();
    wb.setCell("A1", tooLong);
    expect(code(wb.getValue("A1"))).toBe("#LIMIT!");
    expect(limitMessage(wb.getValue("A1"))).toMatch(/1024/);
  });
  it("is configurable", () => {
    const wb = createWorkbook({ maxFormulaLength: 5 });
    wb.setCell("A1", "=1+1");
    wb.setCell("A2", "=1+1+1");
    expect(wb.getValue("A1")).toBe(2);
    expect(code(wb.getValue("A2"))).toBe("#LIMIT!");
  });
});

describe("string length limit (Excel's 32,767)", () => {
  it("long typed text is #LIMIT!", () => {
    const wb = createWorkbook();
    wb.setCell("A1", "x".repeat(32768));
    expect(code(wb.getValue("A1"))).toBe("#LIMIT!");
  });
  it("doubling concatenation cannot explode memory", () => {
    const wb = createWorkbook();
    const cells: Record<string, string> = { A1: "x".repeat(1000) };
    for (let r = 2; r <= 100; r++) cells[`A${r}`] = `=A${r - 1}&A${r - 1}`;
    const t0 = performance.now();
    wb.setCells(cells);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect((wb.getValue("A6") as string).length).toBe(32000);
    expect(code(wb.getValue("A7"))).toBe("#VALUE!");
    expect(code(wb.getValue("A100"))).toBe("#VALUE!");
  });
});
