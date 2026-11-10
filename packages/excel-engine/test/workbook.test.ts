import { describe, expect, it } from "vitest";
import { createWorkbook, evaluateSheet, LimitError } from "../src";
import { code } from "./helpers";

describe("workbook basics", () => {
  it("sets constants and formulas", () => {
    const wb = createWorkbook();
    wb.setCell("A1", "10");
    wb.setCell("A2", "=A1*2");
    expect(wb.getValue("A2")).toBe(20);
    expect(wb.getInput("A2")).toBe("=A1*2");
    expect(wb.getValue("a2")).toBe(20);
    expect(wb.getValue("$A$2")).toBe(20);
  });
  it("clearing a cell makes it blank and updates dependents", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "10", A2: "=A1+1" });
    wb.setCell("A1", "");
    expect(wb.getValue("A1")).toBeNull();
    expect(wb.getValue("A2")).toBe(1);
    expect(wb.stats().cells).toBe(1);
  });
  it("snapshot lists non-empty cells in row-major order", () => {
    const wb = createWorkbook();
    wb.setCells({ B2: "=A1", A1: "1", A2: "x" });
    expect(Object.keys(wb.snapshot())).toEqual(["A1", "A2", "B2"]);
    expect(wb.snapshot()).toEqual({ A1: 1, A2: "x", B2: 1 });
    expect(wb.inputs()).toEqual({ A1: "1", A2: "x", B2: "=A1" });
  });
  it("rejects malformed references and non-text input", () => {
    const wb = createWorkbook();
    expect(() => wb.setCell("1A", "1")).toThrow(RangeError);
    expect(() => wb.setCell("A0", "1")).toThrow(RangeError);
    expect(() => wb.setCell("A1", 5 as unknown as string)).toThrow(TypeError);
  });
  it("evaluateSheet computes a whole sheet and never throws on bad cells", () => {
    const out = evaluateSheet({ A1: "2", A2: "=A1^2", "!!": "1", AE1: "1", B1: "=A2+1" });
    expect(out.A2).toBe(4);
    expect(out.B1).toBe(5);
    expect(code(out["!!"]!)).toBe("#REF!");
    expect(code(out.AE1!)).toBe("#LIMIT!");
  });
});

describe("dependency graph and incremental recalculation", () => {
  it("tracks precedents (ranges expanded) and dependents", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "1", A2: "2", B1: "=SUM(A1:A3)+A1" });
    expect(wb.precedentsOf("B1")).toEqual(["A1", "A2", "A3"]);
    expect(wb.dependentsOf("A3")).toEqual(["B1"]);
    expect(wb.stats().edges).toBe(3);
  });
  it("recalculates only the changed cell's dependents, in topological order", () => {
    const wb = createWorkbook();
    wb.setCells({
      A1: "1",
      A2: "=A1+1",
      A3: "=A2+A1",
      A4: "=A3*2",
      B1: "100",
      B2: "=B1+1", // unrelated chain
      C1: "=SUM(B1:B2)",
    });
    const r = wb.setCell("A1", "5");
    expect(r.recalculated).toEqual(["A2", "A3", "A4"]);
    expect(wb.getValue("A4")).toBe((5 + 1 + 5) * 2);
    expect(wb.getValue("C1")).toBe(201);
  });
  it("orders diamonds correctly", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "1", B1: "=A1+1", B2: "=A1*10", C1: "=B1+B2" });
    const r = wb.setCell("A1", "2");
    expect(r.recalculated.indexOf("C1")).toBeGreaterThan(r.recalculated.indexOf("B1"));
    expect(r.recalculated.indexOf("C1")).toBeGreaterThan(r.recalculated.indexOf("B2"));
    expect(wb.getValue("C1")).toBe(23);
  });
  it("changing a formula re-wires its precedents", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "1", A2: "2", B1: "=A1" });
    wb.setCell("B1", "=A2");
    expect(wb.dependentsOf("A1")).toEqual([]);
    expect(wb.setCell("A1", "9").recalculated).toEqual([]);
    expect(wb.setCell("A2", "9").recalculated).toEqual(["B1"]);
    expect(wb.getValue("B1")).toBe(9);
  });
  it("filling a previously blank referenced cell updates dependents", () => {
    const wb = createWorkbook();
    wb.setCell("B1", "=SUM(A1:A5)");
    expect(wb.getValue("B1")).toBe(0);
    expect(wb.setCell("A4", "7").recalculated).toEqual(["B1"]);
    expect(wb.getValue("B1")).toBe(7);
  });
});

describe("circular references", () => {
  it("self reference is #CIRC!", () => {
    const wb = createWorkbook();
    wb.setCell("A1", "=A1+1");
    expect(code(wb.getValue("A1"))).toBe("#CIRC!");
    expect((wb.getValue("A1") as { message: string }).message).toMatch(/A1 refers to itself/);
  });
  it("indirect cycles mark every member", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "=C1", B1: "=A1", C1: "=B1" });
    for (const k of ["A1", "B1", "C1"]) expect(code(wb.getValue(k))).toBe("#CIRC!");
  });
  it("range self-inclusion is circular", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "1", A3: "=SUM(A1:A3)" });
    expect(code(wb.getValue("A3"))).toBe("#CIRC!");
  });
  it("cells downstream of a cycle get the propagated error; unrelated cells are fine", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "=B1", B1: "=A1", C1: "=A1+1", D1: "5", E1: "=D1*2" });
    expect(code(wb.getValue("C1"))).toBe("#CIRC!");
    expect(wb.getValue("E1")).toBe(10);
  });
  it("IF does not hide a static cycle (as Excel's circular check)", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "=IF(TRUE,1,B1)", B1: "=A1" });
    expect(code(wb.getValue("A1"))).toBe("#CIRC!");
  });
  it("breaking the cycle recovers", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "=B1", B1: "=A1", C1: "=B1*2" });
    wb.setCell("B1", "21");
    expect(wb.getValue("A1")).toBe(21);
    expect(wb.getValue("C1")).toBe(42);
  });
  it("a long cycle (400 cells) is detected without stack overflow", () => {
    const wb = createWorkbook();
    const cells: Record<string, string> = {};
    for (let r = 1; r <= 100; r++) {
      for (const c of ["A", "B", "C", "D"]) cells[`${c}${r}`] = "";
    }
    const keys = Object.keys(cells);
    keys.forEach((k, i) => (cells[k] = `=${keys[(i + 1) % keys.length]}+1`));
    wb.setCells(cells);
    expect(code(wb.getValue("A1"))).toBe("#CIRC!");
    expect(code(wb.getValue("D100"))).toBe("#CIRC!");
  });
});

describe("determinism", () => {
  const sheet: Record<string, string> = {};
  for (let r = 1; r <= 20; r++) {
    sheet[`A${r}`] = String((r * 7919) % 101);
    sheet[`B${r}`] = `=A${r}*1.1+${r > 1 ? `B${r - 1}` : "0"}`;
    sheet[`C${r}`] = `=IF(B${r}>100,"high","low")&" "&AVERAGE(A1:A${r})`;
  }
  sheet.D1 = "=D2";
  sheet.D2 = "=D1";
  sheet.E1 = "=SUM(A1:A20)/COUNT(A1:A20)";

  it("same input gives identical output, regardless of key order", () => {
    const a = evaluateSheet(sheet);
    const b = evaluateSheet(sheet);
    const reversed = Object.fromEntries(Object.entries(sheet).reverse());
    const c = evaluateSheet(reversed);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(c).toEqual(a);
  });
  it("incremental edits match a from-scratch evaluation", () => {
    const wb = createWorkbook();
    wb.setCells(sheet);
    wb.setCell("A5", "1000");
    wb.setCell("A7", "");
    const fresh = evaluateSheet({ ...wb.inputs() });
    expect(wb.snapshot()).toEqual(fresh);
  });
});

describe("limit errors are typed", () => {
  it("setCell throws LimitError outside the grid", () => {
    const wb = createWorkbook();
    expect(() => wb.setCell("AE1", "1")).toThrow(LimitError);
    expect(() => wb.setCell("A101", "1")).toThrow(LimitError);
  });
});
