import { describe, expect, it } from "vitest";
import { createWorkbook, formatNumber, formatValue, parseConstant, type CellValue } from "../src";
import { code, ev } from "./helpers";

describe("arithmetic", () => {
  it("evaluates operators", () => {
    expect(ev("=1+2*3")).toBe(7);
    expect(ev("=(1+2)*3")).toBe(9);
    expect(ev("=10-2-3")).toBe(5);
    expect(ev("=7/2")).toBe(3.5);
    expect(ev("=2^10")).toBe(1024);
    expect(ev("=2^3^2")).toBe(64);
  });
  it("=-2^2 is 4 (unary minus before ^, as in Excel)", () => {
    expect(ev("=-2^2")).toBe(4);
    expect(ev("=0-2^2")).toBe(-4);
    expect(ev("=-(2^2)")).toBe(-4);
  });
  it("unary plus and minus", () => {
    expect(ev("=--3")).toBe(3);
    expect(ev("=+3")).toBe(3);
    expect(ev("=-A1", { A1: "4" })).toBe(-4);
    expect(ev("=-A1")).toBe(0);
  });
  it("% postfix divides by 100", () => {
    expect(ev("=50%")).toBe(0.5);
    expect(ev("=200*10%")).toBe(20);
    expect(ev("=A1%", { A1: "25" })).toBe(0.25);
    expect(ev("=5%%")).toBeCloseTo(0.0005, 12);
  });
  it("blank cells count as 0", () => {
    expect(ev("=A1+5")).toBe(5);
    expect(ev("=A1*5")).toBe(0);
    expect(ev("=A1")).toBe(0);
  });
  it("booleans count as 1/0", () => {
    expect(ev("=TRUE+TRUE")).toBe(2);
    expect(ev("=A1*3", { A1: "TRUE" })).toBe(3);
  });
  it("numeric-looking text is coerced; other text is #VALUE!", () => {
    expect(ev('="3"+4')).toBe(7);
    expect(ev("=A1*2", { A1: "'12" })).toBe(24); // text "12" typed with an apostrophe
    expect(ev('=" 1.5e1 "+0')).toBe(15);
    expect(ev('="50%"*2')).toBe(1);
    expect(code(ev('="abc"+1'))).toBe("#VALUE!");
    expect(code(ev('=""+1'))).toBe("#VALUE!");
    expect(code(ev('="1,000"+1'))).toBe("#VALUE!");
    expect(code(ev("=A1+1", { A1: "Jan" }))).toBe("#VALUE!");
  });
  it("division by zero is #DIV/0! (also by a blank cell)", () => {
    expect(code(ev("=1/0"))).toBe("#DIV/0!");
    expect(code(ev("=1/A1"))).toBe("#DIV/0!");
    expect(code(ev("=0^-1"))).toBe("#DIV/0!");
  });
  it("invalid or overflowing numbers are #NUM!", () => {
    expect(code(ev("=0^0"))).toBe("#NUM!");
    expect(code(ev("=(-8)^(1/3)"))).toBe("#NUM!");
    expect(code(ev("=10^400"))).toBe("#NUM!");
    expect(code(ev("=1E400"))).toBe("#NUM!");
  });
  it("-0 is shown as 0", () => {
    expect(ev("=-0")).toBe(0);
    expect(formatValue(ev("=-0"))).toBe("0");
  });
});

describe("comparison and concatenation", () => {
  it("compares numbers", () => {
    expect(ev("=1<2")).toBe(true);
    expect(ev("=2<=2")).toBe(true);
    expect(ev("=3>=4")).toBe(false);
    expect(ev("=1<>1")).toBe(false);
    expect(ev("=1=1")).toBe(true);
  });
  it("compares text case-insensitively", () => {
    expect(ev('="abc"="ABC"')).toBe(true);
    expect(ev('="apple"<"Banana"')).toBe(true);
  });
  it("orders numbers < text < booleans and does not coerce text", () => {
    expect(ev('=1<"0"')).toBe(true);
    expect(ev('="z"<FALSE')).toBe(true);
    expect(ev('="1"=1')).toBe(false);
  });
  it("blank equals 0, empty text and FALSE", () => {
    expect(ev("=A1=0")).toBe(true);
    expect(ev('=A1=""')).toBe(true);
    expect(ev("=A1=FALSE")).toBe(true);
    expect(ev("=A1=B1")).toBe(true);
  });
  it("concatenates with &", () => {
    expect(ev('="a"&"b"')).toBe("ab");
    expect(ev('="Total: "&A1', { A1: "358" })).toBe("Total: 358");
    expect(ev('=1&2')).toBe("12");
    expect(ev('=TRUE&""')).toBe("TRUE");
    expect(ev('="x"&A1')).toBe("x");
    expect(ev("=0.1+0.2&\"\"")).toBe("0.3");
  });
});

describe("error propagation", () => {
  const cells = { A1: "=1/0", A2: '="x"+1', A3: "=XLOOKUP(1,B1:B2,C1:C2)" };
  it("propagates through arithmetic, comparison, concat, unary, %", () => {
    for (const f of ["=A1+1", "=1+A1", "=A1>1", '=A1&"x"', "=-A1", "=A1%", "=(A1)"]) {
      expect(code(ev(f, cells))).toBe("#DIV/0!");
    }
  });
  it("returns the first (leftmost) error", () => {
    expect(code(ev("=A2+A1", cells))).toBe("#VALUE!");
    expect(code(ev("=A1+A2", cells))).toBe("#DIV/0!");
  });
  it("propagates through chains of cells", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "=1/0", B1: "=A1*2", C1: "=SUM(B1,1)", D1: "=IF(C1>0,1,0)" });
    for (const k of ["B1", "C1", "D1"]) expect(code(wb.getValue(k))).toBe("#DIV/0!");
  });
  it("propagates #NAME? from unsupported functions", () => {
    expect(code(ev("=A3+1", cells))).toBe("#NAME?");
    const wb = createWorkbook();
    wb.setCell("A1", "=XLOOKUP(1,B1:B2,C1:C2)");
    const v = wb.getValue("A1") as { error: string; message: string };
    expect(v.error).toBe("#NAME?");
    expect(v.message).toMatch(/XLOOKUP is not available/);
  });
  it("syntax errors are #ERROR! values, not crashes", () => {
    expect(code(ev("=SUM(1"))).toBe("#ERROR!");
  });
});

describe("references", () => {
  it("absolute, mixed and relative refs read the same cell", () => {
    const cells = { B3: "7" };
    for (const f of ["=B3", "=$B$3", "=B$3", "=$B3", "=b3"]) expect(ev(f, cells)).toBe(7);
  });
  it("ranges with $ work", () => {
    expect(ev("=SUM($A$1:$A$3)", { A1: "1", A2: "2", A3: "3" })).toBe(6);
  });
  it("refs outside the grid are #LIMIT!", () => {
    expect(code(ev("=AE1"))).toBe("#LIMIT!");
    expect(code(ev("=A101"))).toBe("#LIMIT!");
    expect(code(ev("=SUM(A1:A101)"))).toBe("#LIMIT!");
  });
  it("text values are returned as-is", () => {
    expect(ev("=A1", { A1: "Jan" })).toBe("Jan");
  });
});

describe("constants and display", () => {
  it("parses typed constants", () => {
    expect(parseConstant("42")).toBe(42);
    expect(parseConstant("-1.5")).toBe(-1.5);
    expect(parseConstant("4%")).toBe(0.04);
    expect(parseConstant("true")).toBe(true);
    expect(parseConstant("'42")).toBe("42");
    expect(parseConstant("Jan")).toBe("Jan");
    expect(parseConstant("1,000")).toBe("1,000");
  });
  it("formats numbers like Excel General (15 significant digits)", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(358)).toBe("358");
    expect(formatNumber(-2.5)).toBe("-2.5");
    expect(formatNumber(1 / 3)).toBe("0.333333333333333");
    expect(formatNumber(1e15)).toBe("1E+15");
    expect(formatNumber(1.5e-7)).toBe("1.5E-07");
    expect(formatNumber(123456789012345)).toBe("123456789012345");
  });
  it("formats each value kind", () => {
    const cases: [CellValue, string][] = [
      [null, ""],
      [true, "TRUE"],
      [false, "FALSE"],
      ["x", "x"],
      [{ error: "#DIV/0!", message: "" }, "#DIV/0!"],
    ];
    for (const [v, s] of cases) expect(formatValue(v)).toBe(s);
  });
  it("getDisplay shows computed values", () => {
    const wb = createWorkbook();
    wb.setCells({ A1: "=1/3", A2: "=1/0", A3: "=TRUE" });
    expect(wb.getDisplay("A1")).toBe("0.333333333333333");
    expect(wb.getDisplay("A2")).toBe("#DIV/0!");
    expect(wb.getDisplay("A3")).toBe("TRUE");
    expect(wb.getDisplay("A4")).toBe("");
  });
});
