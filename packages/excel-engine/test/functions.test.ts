import { describe, expect, it } from "vitest";
import { code, ev } from "./helpers";

const DATA = { A1: "10", A2: "20", A3: "", A4: "text", A5: "TRUE", B1: "5", B2: "=1/0" };

describe("SUM", () => {
  it("adds numbers, ranges and refs", () => {
    expect(ev("=SUM(1,2,3)")).toBe(6);
    expect(ev("=SUM(A1:A2)", DATA)).toBe(30);
    expect(ev("=SUM(A1:A2,B1,100)", DATA)).toBe(135);
  });
  it("ignores blanks, text and booleans inside ranges", () => {
    expect(ev("=SUM(A1:A5)", DATA)).toBe(30);
  });
  it("ignores text in a single referenced cell (range rules)", () => {
    expect(ev("=SUM(A4)", DATA)).toBe(0);
  });
  it("coerces direct arguments", () => {
    expect(ev('=SUM("3",TRUE)')).toBe(4);
    expect(code(ev('=SUM("abc")'))).toBe("#VALUE!");
  });
  it("propagates errors in ranges", () => {
    expect(code(ev("=SUM(A1:B2)", DATA))).toBe("#DIV/0!");
  });
  it("is 0 for an all-blank range", () => {
    expect(ev("=SUM(C1:C10)")).toBe(0);
  });
  it("accepts reversed ranges and 2-D ranges", () => {
    expect(ev("=SUM(B1:A1)", DATA)).toBe(15);
    expect(ev("=SUM(A1:B1)", DATA)).toBe(15);
  });
});

describe("AVERAGE", () => {
  it("averages numbers only", () => {
    expect(ev("=AVERAGE(A1:A5)", DATA)).toBe(15);
    expect(ev("=AVERAGE(1,2,3,4)")).toBe(2.5);
  });
  it("is #DIV/0! with no numbers", () => {
    expect(code(ev("=AVERAGE(C1:C5)"))).toBe("#DIV/0!");
    expect(code(ev("=AVERAGE(A3:A4)", DATA))).toBe("#DIV/0!");
  });
  it("propagates errors", () => {
    expect(code(ev("=AVERAGE(B1:B2)", DATA))).toBe("#DIV/0!");
    expect(code(ev('=AVERAGE(1,"x")'))).toBe("#VALUE!");
  });
});

describe("MIN and MAX", () => {
  it("find extremes", () => {
    expect(ev("=MIN(A1:A5,B1)", DATA)).toBe(5);
    expect(ev("=MAX(A1:A5,B1)", DATA)).toBe(20);
    expect(ev("=MIN(-1,0,1)")).toBe(-1);
    expect(ev("=MAX(-5,-3)")).toBe(-3);
  });
  it("return 0 when there are no numbers (as Excel)", () => {
    expect(ev("=MIN(C1:C3)")).toBe(0);
    expect(ev("=MAX(A3:A4)", DATA)).toBe(0);
  });
  it("propagate errors", () => {
    expect(code(ev("=MAX(B2)", DATA))).toBe("#DIV/0!");
  });
});

describe("COUNT", () => {
  it("counts numbers only in ranges", () => {
    expect(ev("=COUNT(A1:A5)", DATA)).toBe(2);
    expect(ev("=COUNT(C1:C9)")).toBe(0);
  });
  it("counts numeric direct arguments (numbers, booleans, numeric text)", () => {
    expect(ev('=COUNT(1,"2",TRUE,"x")')).toBe(3);
  });
  it("ignores errors instead of propagating them (as Excel)", () => {
    expect(ev("=COUNT(A1:B2)", DATA)).toBe(3);
    expect(ev("=COUNT(1/0,5)")).toBe(1);
  });
});

describe("IF", () => {
  it("chooses a branch", () => {
    expect(ev('=IF(A1>5,"big","small")', DATA)).toBe("big");
    expect(ev('=IF(A1>50,"big","small")', DATA)).toBe("small");
  });
  it("returns FALSE when the false branch is omitted", () => {
    expect(ev('=IF(1>2,"y")')).toBe(false);
  });
  it("coerces conditions", () => {
    expect(ev("=IF(0,1,2)")).toBe(2);
    expect(ev("=IF(-3,1,2)")).toBe(1);
    expect(ev("=IF(C1,1,2)")).toBe(2); // blank is FALSE
    expect(ev('=IF("true",1,2)')).toBe(1);
    expect(code(ev('=IF("maybe",1,2)'))).toBe("#VALUE!");
  });
  it("is lazy: the unused branch is never evaluated", () => {
    expect(ev("=IF(TRUE,1,1/0)")).toBe(1);
    expect(ev("=IF(FALSE,1/0,2)")).toBe(2);
    expect(ev("=IF(TRUE,1,B2)", DATA)).toBe(1);
  });
  it("propagates errors from the condition and the chosen branch", () => {
    expect(code(ev("=IF(B2,1,2)", DATA))).toBe("#DIV/0!");
    expect(code(ev("=IF(TRUE,B2,2)", DATA))).toBe("#DIV/0!");
  });
  it("nests (IF chain as a lookup substitute)", () => {
    const f = "=IF(A1>=100,0.06,IF(A1>=50,0.04,0.02))";
    expect(ev(f, { A1: "120" })).toBe(0.06);
    expect(ev(f, { A1: "50" })).toBe(0.04);
    expect(ev(f, { A1: "10" })).toBe(0.02);
  });
  it("returns 0 for a blank referenced branch (as Excel)", () => {
    expect(ev("=IF(TRUE,C1,1)")).toBe(0);
  });
});

describe("functions are case-insensitive", () => {
  it("sum/Sum/SUM", () => {
    expect(ev("=sum(1,2)")).toBe(3);
    expect(ev("=Sum(1,2)")).toBe(3);
    expect(ev('=iF(TRUE,"a","b")')).toBe("a");
  });
});

describe("ranges outside aggregates", () => {
  it("is #VALUE! (no implicit intersection or spilling)", () => {
    expect(code(ev("=A1:A2", DATA))).toBe("#VALUE!");
    expect(code(ev("=A1:A2+1", DATA))).toBe("#VALUE!");
    expect(code(ev("=IF(TRUE,A1:A2,0)", DATA))).toBe("#VALUE!");
  });
});
