import { describe, expect, it } from "vitest";
import { createWorkbook, ENGINE_VERSION, isSupportedFunction, parseFormula, SUPPORTED_FUNCTIONS } from "../src";
import { code, ev } from "./helpers";

const NEW_FUNCTIONS = [
  "ROUND",
  "ABS",
  "AND",
  "OR",
  "NOT",
  "IFERROR",
  "MEDIAN",
  "SUMIF",
  "COUNTIF",
  "AVERAGEIF",
  "SUMIFS",
  "COUNTIFS",
  "LEN",
  "LEFT",
  "RIGHT",
  "UPPER",
  "LOWER",
  "TRIM",
];

describe("engine 0.3.0 registration", () => {
  it("reports the new engine version", () => {
    expect(ENGINE_VERSION).toBe("0.3.0");
  });
  it("lists every new function in the allow-list, once", () => {
    for (const f of NEW_FUNCTIONS) {
      expect(isSupportedFunction(f)).toBe(true);
      expect(SUPPORTED_FUNCTIONS.filter((x) => x === f)).toHaveLength(1);
    }
    expect(SUPPORTED_FUNCTIONS).toHaveLength(25);
  });
  it("parses the new functions case-insensitively", () => {
    expect(parseFormula("=round(1.5,0)")).toMatchObject({ type: "call", name: "ROUND" });
    expect(parseFormula('=Countif(A1:A3,"x")')).toMatchObject({ type: "call", name: "COUNTIF" });
  });
  it("rejects wrong argument counts with #ERROR!", () => {
    for (const f of [
      "=ROUND(1)",
      "=ROUND(1,2,3)",
      "=ABS()",
      "=ABS(1,2)",
      "=AND()",
      "=NOT(1,2)",
      "=NOT()",
      "=IFERROR(1)",
      "=IFERROR(1,2,3)",
      "=MEDIAN()",
      "=SUMIF(A1:A3)",
      "=SUMIF(A1:A3,1,B1:B3,C1:C3)",
      "=COUNTIF(A1:A3)",
      "=COUNTIF(A1:A3,1,2)",
      "=AVERAGEIF(A1:A3)",
      "=SUMIFS(A1:A3)",
      "=SUMIFS(A1:A3,B1:B3)",
      "=SUMIFS(A1:A3,B1:B3,1,C1:C3)",
      "=COUNTIFS(A1:A3)",
      "=COUNTIFS(A1:A3,1,B1:B3)",
      "=LEN()",
      "=LEN(1,2)",
      "=LEFT()",
      "=LEFT(1,2,3)",
      "=RIGHT()",
      "=UPPER(1,2)",
      "=LOWER()",
      "=TRIM(1,2)",
    ]) {
      expect(code(ev(f)), f).toBe("#ERROR!");
    }
  });
});

describe("ROUND", () => {
  it("matches the Excel documentation examples", () => {
    expect(ev("=ROUND(2.15,1)")).toBe(2.2);
    expect(ev("=ROUND(2.149,1)")).toBe(2.1);
    expect(ev("=ROUND(-1.475,2)")).toBe(-1.48);
    expect(ev("=ROUND(21.5,-1)")).toBe(20);
    expect(ev("=ROUND(626.3,-3)")).toBe(1000);
    expect(ev("=ROUND(1.98,-1)")).toBe(0);
    expect(ev("=ROUND(-50.55,-2)")).toBe(-100);
  });
  it("rounds half away from zero on the decimal value", () => {
    expect(ev("=ROUND(2.5,0)")).toBe(3);
    expect(ev("=ROUND(-2.5,0)")).toBe(-3);
    expect(ev("=ROUND(0.5,0)")).toBe(1);
    expect(ev("=ROUND(2.675,2)")).toBe(2.68);
    expect(ev("=ROUND(1.005,2)")).toBe(1.01);
    expect(ev("=ROUND(-2.675,2)")).toBe(-2.68);
    expect(ev("=ROUND(1234.5678,2)")).toBe(1234.57);
    expect(ev("=ROUND(1234.5678,-2)")).toBe(1200);
    expect(ev("=ROUND(7,0)")).toBe(7);
  });
  it("truncates fractional digits like Excel", () => {
    expect(ev("=ROUND(2.567,1.9)")).toBe(2.6);
    expect(ev("=ROUND(2.567,-0.5)")).toBe(3);
    expect(ev("=ROUND(25,-1.9)")).toBe(30);
    expect(ev("=ROUND(2.567,0.9)")).toBe(3);
  });
  it("never returns negative zero", () => {
    expect(Object.is(ev("=ROUND(-0.4,0)"), 0)).toBe(true);
    expect(Object.is(ev("=ROUND(-4,-1)"), 0)).toBe(true); // -4 rounds to 0 at tens
  });
  it("handles extreme digits without overflow", () => {
    expect(ev("=ROUND(5,500)")).toBe(5);
    expect(ev("=ROUND(5,-500)")).toBe(0);
    expect(ev("=ROUND(123456789012,-3)")).toBe(123456789000);
  });
  it("coerces text and blanks and propagates errors", () => {
    expect(ev('=ROUND("3.14159","2")')).toBe(3.14);
    expect(ev("=ROUND(A1,2)")).toBe(0);
    expect(code(ev('=ROUND("abc",1)'))).toBe("#VALUE!");
    expect(code(ev("=ROUND(1,\"x\")"))).toBe("#VALUE!");
    expect(code(ev("=ROUND(1/0,1)"))).toBe("#DIV/0!");
    expect(code(ev("=ROUND(1,1/0)"))).toBe("#DIV/0!");
    expect(code(ev("=ROUND(A1:A2,1)"))).toBe("#VALUE!");
  });
});

describe("ABS", () => {
  it("returns the absolute value", () => {
    expect(ev("=ABS(-5)")).toBe(5);
    expect(ev("=ABS(5)")).toBe(5);
    expect(ev("=ABS(0)")).toBe(0);
    expect(ev("=ABS(-2.5)")).toBe(2.5);
    expect(ev("=ABS(A1-A2)", { A1: "3", A2: "10" })).toBe(7);
  });
  it("coerces blanks, booleans and numeric text; rejects other text", () => {
    expect(ev("=ABS(B1)")).toBe(0);
    expect(ev("=ABS(TRUE)")).toBe(1);
    expect(ev('=ABS("-3")')).toBe(3);
    expect(code(ev('=ABS("x")'))).toBe("#VALUE!");
  });
  it("propagates errors and rejects ranges", () => {
    expect(code(ev("=ABS(1/0)"))).toBe("#DIV/0!");
    expect(code(ev("=ABS(A1:A2)"))).toBe("#VALUE!");
  });
});

describe("AND / OR", () => {
  const D = { A1: "TRUE", A2: "5", A3: "text", A4: "", A5: "0", B1: "=1/0" };
  it("combine booleans and numbers", () => {
    expect(ev("=AND(TRUE,TRUE)")).toBe(true);
    expect(ev("=AND(TRUE,FALSE)")).toBe(false);
    expect(ev("=AND(1,2)")).toBe(true);
    expect(ev("=AND(1,0)")).toBe(false);
    expect(ev("=OR(FALSE,FALSE)")).toBe(false);
    expect(ev("=OR(FALSE,TRUE)")).toBe(true);
    expect(ev("=OR(0,0,3)")).toBe(true);
    expect(ev("=AND(2>1,3>2)")).toBe(true);
    expect(ev("=OR(2<1,3<2)")).toBe(false);
  });
  it("ignore text and blanks inside ranges and references", () => {
    expect(ev("=AND(A1:A4)", D)).toBe(true);
    expect(ev("=AND(A1:A5)", D)).toBe(false);
    expect(ev("=OR(A3:A5)", D)).toBe(false);
    expect(ev("=OR(A2:A5)", D)).toBe(true);
    expect(ev("=AND(A3,A2)", D)).toBe(true);
  });
  it("give #VALUE! when there are no logical values", () => {
    expect(code(ev("=AND(A3:A4)", D))).toBe("#VALUE!");
    expect(code(ev("=OR(A3)", D))).toBe("#VALUE!");
    expect(code(ev("=AND(C1:C5)"))).toBe("#VALUE!");
  });
  it("coerce direct text only when it says TRUE or FALSE", () => {
    expect(ev('=AND("TRUE")')).toBe(true);
    expect(ev('=OR("false")')).toBe(false);
    expect(code(ev('=AND("abc")'))).toBe("#VALUE!");
    expect(code(ev('=OR(TRUE,"abc")'))).toBe("#VALUE!");
  });
  it("do not short-circuit: errors always propagate (as Excel)", () => {
    expect(code(ev("=AND(FALSE,1/0)"))).toBe("#DIV/0!");
    expect(code(ev("=OR(TRUE,1/0)"))).toBe("#DIV/0!");
    expect(code(ev("=AND(A1:B1)", D))).toBe("#DIV/0!");
    expect(code(ev("=OR(B1)", D))).toBe("#DIV/0!");
  });
});

describe("NOT", () => {
  it("negates booleans, numbers and blanks", () => {
    expect(ev("=NOT(TRUE)")).toBe(false);
    expect(ev("=NOT(FALSE)")).toBe(true);
    expect(ev("=NOT(0)")).toBe(true);
    expect(ev("=NOT(5)")).toBe(false);
    expect(ev("=NOT(A1)")).toBe(true);
    expect(ev("=NOT(2>1)")).toBe(false);
    expect(ev('=NOT("TRUE")')).toBe(false);
  });
  it("rejects other text and ranges, propagates errors", () => {
    expect(code(ev('=NOT("x")'))).toBe("#VALUE!");
    expect(code(ev("=NOT(A1:A2)"))).toBe("#VALUE!");
    expect(code(ev("=NOT(1/0)"))).toBe("#DIV/0!");
  });
});

describe("IFERROR", () => {
  it("returns the value when there is no error", () => {
    expect(ev('=IFERROR(10/2,"x")')).toBe(5);
    expect(ev('=IFERROR("ok","x")')).toBe("ok");
    expect(ev("=IFERROR(FALSE,1)")).toBe(false);
    expect(ev("=IFERROR(A1,1)")).toBe(0); // a blank shows 0 at the top level
  });
  it("catches every error value the engine can produce", () => {
    expect(ev('=IFERROR(1/0,"d")')).toBe("d");
    expect(ev('=IFERROR("a"+1,"v")')).toBe("v");
    expect(ev('=IFERROR(0^0,"n")')).toBe("n");
    expect(ev('=IFERROR(XLOOKUP("q",A1:A2,B1:B2),"na")', { A1: "a", A2: "b", B1: "1", B2: "2" })).toBe("na");
    expect(ev('=IFERROR(A1,"name")', { A1: "=FOO(1)" })).toBe("name"); // #NAME?
    expect(ev('=IFERROR(A1,"err")', { A1: "=1+" })).toBe("err"); // #ERROR!
    expect(ev('=IFERROR(A1,"lim")', { A1: "=A2000" })).toBe("lim"); // #LIMIT!
    expect(ev('=IFERROR(A1,"circ")', { A1: "=A2", A2: "=A1" })).toBe("circ"); // #CIRC!
    expect(ev('=IFERROR(A1:A2,"range")')).toBe("range"); // a range in a scalar slot is #VALUE!
  });
  it("evaluates the fallback lazily", () => {
    expect(ev("=IFERROR(5,1/0)")).toBe(5);
    expect(code(ev('=IFERROR(1/0,"a"+1)'))).toBe("#VALUE!");
    expect(ev("=IFERROR(1/0,IFERROR(2/0,7))")).toBe(7);
  });
  it("nests inside other functions", () => {
    expect(ev("=SUM(IFERROR(1/0,10),5)")).toBe(15);
    expect(ev('=IF(IFERROR(A1,0)>2,"big","small")', { A1: "=1/0" })).toBe("small");
  });
});

describe("MEDIAN", () => {
  it("returns the middle value or the mean of the two middle values", () => {
    expect(ev("=MEDIAN(1,2,3,4,5)")).toBe(3);
    expect(ev("=MEDIAN(1,2,3,4,5,6)")).toBe(3.5);
    expect(ev("=MEDIAN(5,1,4)")).toBe(4);
    expect(ev("=MEDIAN(7)")).toBe(7);
    expect(ev("=MEDIAN(-1,-2,-3,-4)")).toBe(-2.5);
    expect(ev("=MEDIAN(10,2,38,23,38,23,21)")).toBe(23);
  });
  it("uses range rules: text, blanks and booleans are ignored", () => {
    const D = { A1: "10", A2: "text", A3: "TRUE", A4: "", A5: "30", A6: "20" };
    expect(ev("=MEDIAN(A1:A6)", D)).toBe(20);
    expect(ev("=MEDIAN(A1:A6,100)", D)).toBe(25);
  });
  it("coerces direct arguments", () => {
    expect(ev('=MEDIAN("3",TRUE,5)')).toBe(3);
    expect(code(ev('=MEDIAN("abc",1)'))).toBe("#VALUE!");
  });
  it("gives #NUM! when there are no numbers", () => {
    expect(code(ev("=MEDIAN(A1:A5)"))).toBe("#NUM!");
    expect(code(ev("=MEDIAN(A1:A2)", { A1: "x", A2: "TRUE" }))).toBe("#NUM!");
  });
  it("propagates errors", () => {
    expect(code(ev("=MEDIAN(A1:A3)", { A1: "1", A2: "=1/0", A3: "3" }))).toBe("#DIV/0!");
    expect(code(ev("=MEDIAN(1,1/0)"))).toBe("#DIV/0!");
  });
});

describe("text functions", () => {
  it("LEN counts characters, with numbers in General format", () => {
    expect(ev('=LEN("")')).toBe(0);
    expect(ev('=LEN("hello")')).toBe(5);
    expect(ev('=LEN("héllo wörld")')).toBe(11);
    expect(ev("=LEN(12345)")).toBe(5);
    expect(ev("=LEN(0.1+0.2)")).toBe(3); // "0.3"
    expect(ev("=LEN(-1.5)")).toBe(4);
    expect(ev("=LEN(TRUE)")).toBe(4);
    expect(ev("=LEN(A1)")).toBe(0);
    expect(ev("=LEN(A1)", { A1: "  x " })).toBe(4);
  });
  it("LEFT and RIGHT take 1 character by default", () => {
    expect(ev('=LEFT("Bata")')).toBe("B");
    expect(ev('=RIGHT("Bata")')).toBe("a");
  });
  it("LEFT and RIGHT honour num_chars (0, longer than text, decimals, text numbers)", () => {
    expect(ev('=LEFT("Bata Shoes",4)')).toBe("Bata");
    expect(ev('=RIGHT("Bata Shoes",5)')).toBe("Shoes");
    expect(ev('=LEFT("abc",0)')).toBe("");
    expect(ev('=RIGHT("abc",0)')).toBe("");
    expect(ev('=LEFT("abc",10)')).toBe("abc");
    expect(ev('=RIGHT("abc",10)')).toBe("abc");
    expect(ev('=LEFT("abcdef",2.9)')).toBe("ab");
    expect(ev('=RIGHT("abcdef","2")')).toBe("ef");
    expect(ev("=LEFT(12345,2)")).toBe("12");
    expect(ev("=RIGHT(12345,2)")).toBe("45");
    expect(ev("=LEFT(0.1+0.2,3)")).toBe("0.3");
    expect(ev("=LEFT(A1,2)")).toBe("");
  });
  it("LEFT and RIGHT reject a negative or non-numeric num_chars", () => {
    expect(code(ev('=LEFT("abc",-1)'))).toBe("#VALUE!");
    expect(code(ev('=RIGHT("abc",-1)'))).toBe("#VALUE!");
    expect(code(ev('=LEFT("abc","x")'))).toBe("#VALUE!");
  });
  it("UPPER and LOWER change case; numbers become text", () => {
    expect(ev('=UPPER("Bata Shoes 12")')).toBe("BATA SHOES 12");
    expect(ev('=LOWER("Bata SHOES 12")')).toBe("bata shoes 12");
    expect(ev("=UPPER(12)")).toBe("12");
    expect(ev("=LOWER(TRUE)")).toBe("true");
    expect(ev('=UPPER("straße")')).toBe("STRAßE"); // Excel keeps ß (no length change)
    expect(ev('=UPPER("")')).toBe("");
  });
  it("TRIM strips the ends and collapses internal runs of spaces", () => {
    expect(ev('=TRIM("  a   b  ")')).toBe("a b");
    expect(ev('=TRIM("   ")')).toBe("");
    expect(ev('=TRIM("single")')).toBe("single");
    expect(ev('=TRIM(" First Quarter  Earnings ")')).toBe("First Quarter Earnings");
    expect(ev("=TRIM(12)")).toBe("12");
  });
  it("TRIM only touches the ordinary space (tabs and non-breaking spaces survive)", () => {
    expect(ev("=TRIM(A1)", { A1: "a\t  b" })).toBe("a\t b");
    expect(ev("=LEN(TRIM(A1))", { A1: " x " })).toBe(3);
  });
  it("propagate errors and reject ranges", () => {
    for (const f of ["LEN", "UPPER", "LOWER", "TRIM", "LEFT", "RIGHT"]) {
      expect(code(ev(`=${f}(1/0)`)), f).toBe("#DIV/0!");
      expect(code(ev(`=${f}(A1:A2)`)), f).toBe("#VALUE!");
    }
    expect(code(ev('=LEFT("abc",1/0)'))).toBe("#DIV/0!");
  });
  it("honours the 32,767 character limit", () => {
    const big = "a".repeat(32767);
    expect(ev("=LEN(A1)", { A1: big })).toBe(32767);
    expect((ev("=UPPER(A1)", { A1: big }) as string).length).toBe(32767);
    expect(ev("=LEN(TRIM(A1))", { A1: big })).toBe(32767);
    expect(code(ev('=LEN(A1&"x")', { A1: big }))).toBe("#VALUE!");
    expect(code(ev('=UPPER(A1&"x")', { A1: big }))).toBe("#VALUE!");
    expect(code(ev("=LEN(A1)", { A1: big + "x" }))).toBe("#LIMIT!");
    expect(code(ev('=UPPER(A1&A1)', { A1: "abc" }, { maxStringLength: 5 }))).toBe("#VALUE!");
  });
});

describe("determinism and dependency tracking (scalar and text functions)", () => {
  const CELLS = {
    A1: "10",
    A2: "-20",
    A3: "30.456",
    B1: "  Mixed  Case ",
    C1: "=ROUND(A3,1)+ABS(A2)",
    C2: '=IFERROR(A1/(A1-10),"n/a")',
    C3: "=MEDIAN(A1:A3)",
    C4: "=AND(A1>0,NOT(A2>0))",
    C5: '=UPPER(TRIM(B1))&"|"&LEN(B1)&"|"&LEFT(TRIM(B1),3)&RIGHT(B1,2)',
    C6: "=OR(A1<0,A3<0)",
  };
  it("gives byte-identical results on repeated runs and any insertion order", () => {
    const run = (entries: [string, string][]) => {
      const wb = createWorkbook();
      wb.setCells(Object.fromEntries(entries));
      return JSON.stringify(wb.snapshot());
    };
    const forward = Object.entries(CELLS);
    const a = run(forward);
    expect(run(forward)).toBe(a);
    expect(run([...forward].reverse())).toBe(a);
    const wb = createWorkbook();
    wb.setCells(CELLS);
    expect(wb.getValue("C1")).toBe(50.5);
    expect(wb.getValue("C2")).toBe("n/a");
    expect(wb.getValue("C3")).toBe(10);
    expect(wb.getValue("C4")).toBe(true);
    expect(wb.getValue("C5")).toBe("MIXED CASE|14|Mixe ");
    expect(wb.getValue("C6")).toBe(false);
  });
  it("recalculates only dependents when an input changes", () => {
    const wb = createWorkbook();
    wb.setCells(CELLS);
    const r = wb.setCell("A2", "5");
    expect(r.recalculated).toContain("C1");
    expect(r.recalculated).toContain("C3");
    expect(r.recalculated).toContain("C4");
    expect(r.recalculated).not.toContain("C5");
    expect(wb.getValue("C1")).toBe(35.5);
    expect(wb.getValue("C4")).toBe(false);
    expect(wb.getValue("C3")).toBe(10);
    wb.setCell("B1", "x");
    expect(wb.getValue("C5")).toBe("X|1|xx");
  });
  it("tracks the lazy IFERROR fallback as a dependency", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "=1/0", B1: "7", C1: "=IFERROR(A1,B1)" });
    expect(wb.precedentsOf("C1")).toEqual(["A1", "B1"]);
    expect(wb.getValue("C1")).toBe(7);
    wb.setCell("B1", "8");
    expect(wb.getValue("C1")).toBe(8);
    wb.setCell("A1", "1");
    expect(wb.getValue("C1")).toBe(1);
  });
  it("detects circular references through the new functions", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "=IFERROR(A2,0)", A2: "=ABS(A1)" });
    expect(code(wb.getValue("A1"))).toBe("#CIRC!");
    expect(code(wb.getValue("A2"))).toBe("#CIRC!");
  });
});
