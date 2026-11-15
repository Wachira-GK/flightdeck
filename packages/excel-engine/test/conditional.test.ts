import { describe, expect, it } from "vitest";
import { createWorkbook } from "../src";
import { code, ev } from "./helpers";

// Property values and commissions from Microsoft's SUMIF / AVERAGEIF documentation examples.
const PROP = {
  A1: "100000",
  A2: "200000",
  A3: "300000",
  A4: "400000",
  B1: "7000",
  B2: "14000",
  B3: "21000",
  B4: "28000",
};

// Mixed data: region (A), status (B), amount (C).
const SALES = {
  A1: "North",
  A2: "south",
  A3: "NORTH",
  A4: "East",
  A5: "North",
  B1: "Open",
  B2: "Closed",
  B3: "closed",
  B4: "Open",
  B5: "Closed",
  C1: "100",
  C2: "250",
  C3: "50",
  C4: "75.5",
  C5: "300",
};

describe("SUMIF", () => {
  it("matches the Excel documentation examples", () => {
    expect(ev('=SUMIF(A1:A4,">160000",B1:B4)', PROP)).toBe(63000);
    expect(ev("=SUMIF(A1:A4,300000,B1:B4)", PROP)).toBe(21000);
    expect(ev('=SUMIF(A1:A4,">"&C1,B1:B4)', { ...PROP, C1: "300000" })).toBe(28000);
    expect(ev('=SUMIF(B1:B4,"<=14000")', PROP)).toBe(21000);
  });
  it("sums the range itself when sum_range is omitted", () => {
    expect(ev('=SUMIF(C1:C5,">=100")', SALES)).toBe(650);
    expect(ev("=SUMIF(C1:C5,50)", SALES)).toBe(50);
  });
  it("text equality is case-insensitive", () => {
    expect(ev('=SUMIF(A1:A5,"north",C1:C5)', SALES)).toBe(450);
    expect(ev('=SUMIF(A1:A5,"NORTH",C1:C5)', SALES)).toBe(450);
    expect(ev('=SUMIF(A1:A5,"=North",C1:C5)', SALES)).toBe(450);
  });
  it("supports <> and the ordering operators for numbers and text", () => {
    expect(ev('=SUMIF(B1:B5,"<>Closed",C1:C5)', SALES)).toBe(175.5);
    expect(ev('=SUMIF(C1:C5,"<100")', SALES)).toBe(125.5);
    expect(ev('=SUMIF(C1:C5,">100")', SALES)).toBe(550);
    expect(ev('=SUMIF(C1:C5,"<>100")', SALES)).toBe(675.5);
    expect(ev('=SUMIF(A1:A5,"<n",C1:C5)', SALES)).toBe(75.5); // "East" < "n"
    expect(ev('=SUMIF(A1:A5,">=north",C1:C5)', SALES)).toBe(700);
  });
  it("ignores text, booleans and blanks in the sum range", () => {
    expect(ev('=SUMIF(A1:A4,"x",B1:B4)', { A1: "x", A2: "x", A3: "x", A4: "x", B1: "5", B2: "text", B3: "TRUE", B4: "" })).toBe(5);
  });
  it("propagates an error in a matched row only", () => {
    const D = { A1: "x", A2: "y", B1: "1", B2: "=1/0" };
    expect(ev('=SUMIF(A1:A2,"x",B1:B2)', D)).toBe(1);
    expect(code(ev('=SUMIF(A1:A2,"y",B1:B2)', D))).toBe("#DIV/0!");
    expect(code(ev('=SUMIF(A1:A2,"<>x",B1:B2)', D))).toBe("#DIV/0!");
  });
  it("needs ranges of the same size and real ranges", () => {
    expect(code(ev('=SUMIF(A1:A4,">1",B1:B3)', PROP))).toBe("#VALUE!");
    expect(code(ev('=SUMIF(A1:A4,">1",B1:C4)', PROP))).toBe("#VALUE!");
    expect(code(ev('=SUMIF("x",">1")'))).toBe("#VALUE!");
    expect(code(ev('=SUMIF(A1:A4,">1",5)', PROP))).toBe("#VALUE!");
  });
  it("propagates an error value used as criteria", () => {
    expect(code(ev("=SUMIF(A1:A4,1/0,B1:B4)", PROP))).toBe("#DIV/0!");
    expect(code(ev("=SUMIF(A1:A4,D1,B1:B4)", { ...PROP, D1: "=1/0" }))).toBe("#DIV/0!");
  });
});

describe("COUNTIF", () => {
  it("counts equality matches for numbers and text", () => {
    expect(ev('=COUNTIF(A1:A5,"north")', SALES)).toBe(3);
    expect(ev("=COUNTIF(C1:C5,100)", SALES)).toBe(1);
    expect(ev('=COUNTIF(C1:C5,"=75.5")', SALES)).toBe(1);
    expect(ev('=COUNTIF(B1:B5,"Open")', SALES)).toBe(2);
  });
  it("supports every operator", () => {
    expect(ev('=COUNTIF(C1:C5,">=100")', SALES)).toBe(3);
    expect(ev('=COUNTIF(C1:C5,">100")', SALES)).toBe(2);
    expect(ev('=COUNTIF(C1:C5,"<100")', SALES)).toBe(2);
    expect(ev('=COUNTIF(C1:C5,"<=75.5")', SALES)).toBe(2);
    expect(ev('=COUNTIF(B1:B5,"<>Closed")', SALES)).toBe(2);
    expect(ev('=COUNTIF(C1:C5,"<>100")', SALES)).toBe(4);
    expect(ev('=COUNTIF(C1:C5,">"&C4)', SALES)).toBe(3);
  });
  it("<> counts blanks and text as 'not equal'", () => {
    expect(ev('=COUNTIF(A1:A4,"<>x")', { A1: "x", A2: "y", A3: "" })).toBe(3); // y + 2 blanks
  });
  it("number criteria also match numeric text, as Excel; ordering ignores text", () => {
    const D = { A1: "5", A2: "'5", A3: "abc", A4: "6" };
    expect(ev("=COUNTIF(A1:A4,5)", D)).toBe(2);
    expect(ev('=COUNTIF(A1:A4,"5")', D)).toBe(2);
    expect(ev('=COUNTIF(A1:A4,">4")', D)).toBe(2); // the text "5" is not compared
  });
  it("ordering text criteria only consider text cells", () => {
    expect(ev('=COUNTIF(A1:A4,">a")', { A1: "b", A2: "A", A3: "5", A4: "TRUE" })).toBe(1);
  });
  it("wildcards are NOT supported: * ? are literal characters (documented deviation)", () => {
    const D = { A1: "a*c", A2: "abc", A3: "a?c", A4: "*", A5: "~x" };
    expect(ev('=COUNTIF(A1:A5,"a*c")', D)).toBe(1);
    expect(ev('=COUNTIF(A1:A5,"a?c")', D)).toBe(1);
    expect(ev('=COUNTIF(A1:A5,"*")', D)).toBe(1);
    expect(ev('=COUNTIF(A1:A5,"?")', D)).toBe(0);
    expect(ev('=COUNTIF(A1:A5,"a*")', D)).toBe(0);
    expect(ev('=COUNTIF(A1:A5,"~x")', D)).toBe(1);
    expect(ev('=COUNTIF(A1:A5,"<>*")', D)).toBe(4);
  });
  it("handles blank, empty-text, boolean and zero criteria", () => {
    const D = { A1: "", A2: "0", A3: "TRUE", A4: "x", A5: "FALSE" };
    expect(ev('=COUNTIF(A1:A5,"")', D)).toBe(1); // blank cell (A1)
    expect(ev('=COUNTIF(A1:A5,"=")', D)).toBe(1);
    expect(ev('=COUNTIF(A1:A5,"<>")', D)).toBe(4);
    expect(ev("=COUNTIF(A1:A5,0)", D)).toBe(1);
    expect(ev("=COUNTIF(A1:A5,F1)", D)).toBe(1); // blank criteria cell acts as 0
    expect(ev("=COUNTIF(A1:A5,TRUE)", D)).toBe(1);
    expect(ev('=COUNTIF(A1:A5,"false")', D)).toBe(1);
    expect(ev('=COUNTIF(A1:A5,"<>TRUE")', D)).toBe(4);
  });
  it("skips error cells in the range (they never match) unless counting <>", () => {
    const D = { A1: "5", A2: "=1/0", A3: "7" };
    expect(ev('=COUNTIF(A1:A3,">0")', D)).toBe(2);
    expect(ev("=COUNTIF(A1:A3,5)", D)).toBe(1);
    expect(ev('=COUNTIF(A1:A3,"<>5")', D)).toBe(2);
  });
  it("needs a real range and propagates a criteria error", () => {
    expect(code(ev("=COUNTIF(5,5)"))).toBe("#VALUE!");
    expect(code(ev("=COUNTIF(A1:A3,1/0)"))).toBe("#DIV/0!");
    expect(code(ev('=COUNTIF(A1:A3,"a"+1)'))).toBe("#VALUE!");
  });
  it("counts a single cell reference", () => {
    expect(ev('=COUNTIF(A1,">3")', { A1: "4" })).toBe(1);
  });
});

describe("AVERAGEIF", () => {
  it("matches the Excel documentation examples", () => {
    expect(ev('=AVERAGEIF(A1:A4,"<250000")', PROP)).toBe(150000);
    expect(ev('=AVERAGEIF(B1:B4,"<23000")', PROP)).toBe(14000);
    expect(ev('=AVERAGEIF(A1:A4,">250000",B1:B4)', PROP)).toBe(24500);
    expect(code(ev('=AVERAGEIF(A1:A4,"<95000")', PROP))).toBe("#DIV/0!");
  });
  it("uses average_range and only averages numbers", () => {
    expect(ev('=AVERAGEIF(A1:A5,"north",C1:C5)', SALES)).toBe(150);
    expect(ev('=AVERAGEIF(A1:A3,"x",B1:B3)', { A1: "x", A2: "x", A3: "x", B1: "10", B2: "text", B3: "" })).toBe(10);
  });
  it("is #DIV/0! when nothing matches or matches hold no numbers", () => {
    expect(code(ev('=AVERAGEIF(A1:A5,"west",C1:C5)', SALES))).toBe("#DIV/0!");
    expect(code(ev('=AVERAGEIF(A1:A2,"x",B1:B2)', { A1: "x", A2: "x", B1: "t", B2: "u" }))).toBe("#DIV/0!");
    expect(code(ev('=AVERAGEIF(A1:A3,">1")'))).toBe("#DIV/0!");
  });
  it("propagates matched-row errors and shape mismatches", () => {
    expect(code(ev('=AVERAGEIF(A1:A2,"x",B1:B2)', { A1: "x", A2: "y", B1: "=1/0", B2: "1" }))).toBe("#DIV/0!");
    expect(code(ev('=AVERAGEIF(A1:A4,">1",B1:B2)', PROP))).toBe("#VALUE!");
  });
});

describe("SUMIFS", () => {
  it("combines several criteria with AND", () => {
    expect(ev('=SUMIFS(C1:C5,A1:A5,"north",B1:B5,"open")', SALES)).toBe(100);
    expect(ev('=SUMIFS(C1:C5,A1:A5,"north",B1:B5,"closed")', SALES)).toBe(350);
    expect(ev('=SUMIFS(C1:C5,A1:A5,"north",B1:B5,"<>closed",C1:C5,">=100")', SALES)).toBe(100);
    expect(ev('=SUMIFS(C1:C5,C1:C5,">60",C1:C5,"<=250")', SALES)).toBe(425.5);
  });
  it("works with a single pair and with criteria taken from cells", () => {
    expect(ev('=SUMIFS(C1:C5,B1:B5,"Closed")', SALES)).toBe(600);
    expect(ev("=SUMIFS(C1:C5,A1:A5,E1,B1:B5,E2)", { ...SALES, E1: "North", E2: "Closed" })).toBe(350);
    expect(ev('=SUMIFS(C1:C5,C1:C5,">"&E1)', { ...SALES, E1: "99" })).toBe(650);
  });
  it("is 0 when nothing matches", () => {
    expect(ev('=SUMIFS(C1:C5,A1:A5,"west")', SALES)).toBe(0);
  });
  it("requires same-sized ranges", () => {
    expect(code(ev('=SUMIFS(C1:C5,A1:A4,"north")', SALES))).toBe("#VALUE!");
    expect(code(ev('=SUMIFS(C1:C5,A1:A5,"north",B1:B4,"x")', SALES))).toBe("#VALUE!");
    expect(code(ev('=SUMIFS(C1:C5,A1:B5,"north")', SALES))).toBe("#VALUE!");
    expect(code(ev('=SUMIFS(5,A1:A5,"north")', SALES))).toBe("#VALUE!");
  });
  it("propagates errors of matched rows and of criteria", () => {
    const D = { ...SALES, C2: "=1/0" };
    expect(code(ev('=SUMIFS(C1:C5,A1:A5,"south")', D))).toBe("#DIV/0!");
    expect(ev('=SUMIFS(C1:C5,A1:A5,"east")', D)).toBe(75.5);
    expect(code(ev("=SUMIFS(C1:C5,A1:A5,1/0)", SALES))).toBe("#DIV/0!");
  });
});

describe("COUNTIFS", () => {
  it("counts rows meeting every criterion", () => {
    expect(ev('=COUNTIFS(A1:A5,"north",B1:B5,"closed")', SALES)).toBe(2);
    expect(ev('=COUNTIFS(A1:A5,"north",B1:B5,"open",C1:C5,">=100")', SALES)).toBe(1);
    expect(ev('=COUNTIFS(C1:C5,">50",C1:C5,"<300")', SALES)).toBe(3);
    expect(ev('=COUNTIFS(B1:B5,"closed")', SALES)).toBe(3);
    expect(ev('=COUNTIFS(A1:A5,"west",B1:B5,"closed")', SALES)).toBe(0);
  });
  it("requires same-sized ranges and real ranges", () => {
    expect(code(ev('=COUNTIFS(A1:A5,"north",B1:B4,"x")', SALES))).toBe("#VALUE!");
    expect(code(ev('=COUNTIFS(A1:A5,"x",3,"y")', SALES))).toBe("#VALUE!");
  });
  it("propagates a criteria error", () => {
    expect(code(ev('=COUNTIFS(A1:A5,"north",B1:B5,1/0)', SALES))).toBe("#DIV/0!");
  });
});

describe("conditional aggregates: dependencies, recalculation and budgets", () => {
  it("depend on every range and criteria cell, and recalculate when any changes", () => {
    const wb = createWorkbook();
    wb.setCells({ ...SALES, E1: "North", F1: '=SUMIFS(C1:C5,A1:A5,E1,B1:B5,"closed")' });
    expect(wb.getValue("F1")).toBe(350);
    const expected = ["E1"];
    for (const col of ["A", "B", "C"]) for (let r = 1; r <= 5; r++) expected.push(`${col}${r}`);
    expect(new Set(wb.precedentsOf("F1"))).toEqual(new Set(expected));
    expect(wb.precedentsOf("F1")).toHaveLength(16);
    expect(wb.setCell("C3", "1000").recalculated).toContain("F1");
    expect(wb.getValue("F1")).toBe(1300);
    wb.setCell("E1", "South");
    expect(wb.getValue("F1")).toBe(250);
    wb.setCell("B2", "Open");
    expect(wb.getValue("F1")).toBe(0);
    expect(wb.dependentsOf("E1")).toEqual(["F1"]);
  });
  it("COUNTIF / AVERAGEIF update through chains", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "1", A2: "2", A3: "3", B1: '=COUNTIF(A1:A3,">1")', B2: '=AVERAGEIF(A1:A3,">1")', B3: "=B1*B2" });
    expect(wb.getValue("B3")).toBe(5);
    wb.setCell("A1", "10");
    expect(wb.getValue("B1")).toBe(3);
    expect(wb.getValue("B2")).toBe(5);
    expect(wb.getValue("B3")).toBe(15);
  });
  it("count range cells toward the edge budget", () => {
    const wb = createWorkbook({ maxEdges: 8 });
    wb.setCell("C1", '=COUNTIF(A1:A5,"x")');
    expect(wb.getValue("C1")).toBe(0);
    wb.setCell("C2", '=COUNTIF(B1:B5,"x")'); // 5 + 5 > 8
    expect(code(wb.getValue("C2"))).toBe("#LIMIT!");
  });
  it("stop a formula that scans too many cells (calculation budget)", () => {
    // 11 pairs of 10 cells = 110 scanned; the budget is 4 x maxEdges = 120 for maxEdges 30, here 100.
    const pair = "A1:A10,1,";
    const heavy = `=COUNTIFS(${pair.repeat(11).slice(0, -1)})`;
    expect(code(ev(heavy, {}, { maxEdges: 25 }))).toBe("#LIMIT!");
    expect(ev(heavy, {}, { maxEdges: 30 })).toBe(0);
  });
  it("scans of the default budget: large ranges are fine, too many large ranges are #LIMIT!", () => {
    const ok = `=COUNTIFS(${"A1:AD99,1,".repeat(6).slice(0, -1)})`; // 6 x 2,970 = 17,820 <= 20,000
    const heavy = `=COUNTIFS(${"A1:AD99,1,".repeat(7).slice(0, -1)})`; // 20,790 > 20,000
    expect(ev(ok)).toBe(0);
    expect(code(ev(heavy))).toBe("#LIMIT!");
  });
  it("budget is per formula (several formulas each get a fresh budget)", () => {
    const wb = createWorkbook({ maxEdges: 100 }); // scan budget 400 per formula
    const f = `=COUNTIFS(${"A1:A10,1,".repeat(30).slice(0, -1)})`; // 300 cells each
    wb.setCells({ C1: f, C2: f, C3: f });
    for (const k of ["C1", "C2", "C3"]) expect(wb.getValue(k)).toBe(0);
  });
  it("is deterministic across runs", () => {
    const run = () => {
      const wb = createWorkbook();
      wb.setCells({
        ...SALES,
        E1: '=SUMIFS(C1:C5,A1:A5,"north",B1:B5,"<>closed")',
        E2: '=COUNTIFS(A1:A5,"<>east",C1:C5,">60")',
        E3: '=IFERROR(AVERAGEIF(A1:A5,"zzz",C1:C5),"none")',
      });
      return JSON.stringify(wb.snapshot());
    };
    expect(run()).toBe(run());
    expect(JSON.parse(run()).E1).toBe(100);
    expect(JSON.parse(run()).E2).toBe(3);
    expect(JSON.parse(run()).E3).toBe("none");
  });
});
