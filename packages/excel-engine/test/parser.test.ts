import { describe, expect, it } from "vitest";
import { astDepth, collectFunctions, LimitError, parseFormula, ParseError, tokenize, type AstNode } from "../src";

function p(f: string): AstNode {
  return parseFormula(f);
}

/** Compact S-expression for readable assertions. */
function sx(n: AstNode): string {
  switch (n.type) {
    case "number":
      return String(n.value);
    case "string":
      return JSON.stringify(n.value);
    case "boolean":
      return n.value ? "TRUE" : "FALSE";
    case "ref":
      return n.key;
    case "range":
      return `${String.fromCharCode(65 + n.start.col)}${n.start.row + 1}:${String.fromCharCode(65 + n.end.col)}${n.end.row + 1}`;
    case "unary":
      return `(${n.op === "-" ? "neg" : "pos"} ${sx(n.operand)})`;
    case "percent":
      return `(% ${sx(n.operand)})`;
    case "binary":
      return `(${n.op} ${sx(n.left)} ${sx(n.right)})`;
    case "call":
      return `(${n.name} ${n.args.map(sx).join(" ")})`;
  }
}

function parseErr(f: string): ParseError {
  try {
    parseFormula(f);
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  throw new Error(`expected ParseError for ${f}`);
}

describe("tokenizer", () => {
  it("tokenises numbers, strings, refs, functions, operators", () => {
    const types = tokenize('SUM(A1:$B$2) & "x""y" <= 1.5e3%').map((t) => t.type);
    expect(types).toEqual(["func", "lparen", "ref", "colon", "ref", "rparen", "op", "string", "op", "number", "op", "eof"]);
  });
  it("decodes doubled quotes", () => {
    expect(tokenize('"say ""hi"""')[0]!.text).toBe('say "hi"');
  });
  it("recognises two-char operators", () => {
    expect(
      tokenize("1<>2>=3<=4")
        .filter((t) => t.type === "op")
        .map((t) => t.text),
    ).toEqual(["<>", ">=", "<="]);
  });
  it("upper-cases function names and booleans", () => {
    const t = tokenize("sum(true)");
    expect(t[0]).toMatchObject({ type: "func", text: "SUM" });
    expect(t[2]).toMatchObject({ type: "boolean", text: "TRUE" });
  });
  it("rejects unterminated strings", () => {
    expect(() => tokenize('"abc')).toThrow(ParseError);
  });
  it("rejects numbers glued to letters", () => {
    expect(() => tokenize("12A")).toThrow(ParseError);
  });
});

describe("parser: literals and references", () => {
  it("parses literals", () => {
    expect(sx(p("=42"))).toBe("42");
    expect(sx(p("=.5"))).toBe("0.5");
    expect(sx(p("=1E3"))).toBe("1000");
    expect(sx(p('="hi"'))).toBe('"hi"');
    expect(sx(p("=TRUE"))).toBe("TRUE");
    expect(sx(p("=false"))).toBe("FALSE");
  });
  it("accepts formulas with or without the leading =", () => {
    expect(sx(p("1+2"))).toBe(sx(p("=1+2")));
  });
  it("parses relative, absolute and mixed refs", () => {
    for (const r of ["B3", "$B$3", "B$3", "$B3", "b3"]) {
      const n = p(`=${r}`);
      expect(n.type).toBe("ref");
      if (n.type === "ref") expect(n.key).toBe("B3");
    }
    const n = p("=$B3");
    if (n.type === "ref") expect(n.ref).toMatchObject({ absCol: true, absRow: false });
  });
  it("parses and normalises ranges", () => {
    expect(sx(p("=SUM(A1:B5)"))).toBe("(SUM A1:B5)");
    expect(sx(p("=SUM(B5:A1)"))).toBe("(SUM A1:B5)");
    expect(sx(p("=SUM($A$1:B$5)"))).toBe("(SUM A1:B5)");
  });
  it("ignores whitespace", () => {
    expect(sx(p("=  SUM ( A1 , 2 )  "))).toBe("(SUM A1 2)");
  });
});

describe("parser: precedence (Excel order)", () => {
  it("* before +", () => expect(sx(p("=1+2*3"))).toBe("(+ 1 (* 2 3))"));
  it("^ before *", () => expect(sx(p("=2*3^2"))).toBe("(* 2 (^ 3 2))"));
  it("unary minus binds tighter than ^ (=-2^2 is (-2)^2)", () => expect(sx(p("=-2^2"))).toBe("(^ (neg 2) 2)"));
  it("^ is left-associative", () => expect(sx(p("=2^3^2"))).toBe("(^ (^ 2 3) 2)"));
  it("% binds tighter than ^ and looser than unary minus", () => {
    expect(sx(p("=2^50%"))).toBe("(^ 2 (% 50))");
    expect(sx(p("=-50%"))).toBe("(% (neg 50))");
  });
  it("& is below + and above comparisons", () => {
    expect(sx(p('=1+2&"x"'))).toBe('(& (+ 1 2) "x")');
    expect(sx(p('="a"&"b"="ab"'))).toBe('(= (& "a" "b") "ab")');
  });
  it("comparisons are lowest and left-associative", () => {
    expect(sx(p("=1<2=TRUE"))).toBe("(= (< 1 2) TRUE)");
  });
  it("parentheses override precedence", () => expect(sx(p("=(1+2)*3"))).toBe("(* (+ 1 2) 3)"));
  it("2^-1 parses unary inside the exponent", () => expect(sx(p("=2^-1"))).toBe("(^ 2 (neg 1))"));
  it("subtraction is left-associative", () => expect(sx(p("=10-2-3"))).toBe("(- (- 10 2) 3)"));
});

describe("parser: functions", () => {
  it("parses every supported function case-insensitively", () => {
    for (const f of ["sum", "Average", "MIN", "max", "count"]) {
      expect(p(`=${f}(A1)`)).toMatchObject({ type: "call", name: f.toUpperCase() });
    }
    expect(sx(p('=if(A1>1,"y","n")'))).toBe('(IF (> A1 1) "y" "n")');
  });
  it("parses nested calls", () => {
    expect(collectFunctions(p("=IF(SUM(A1:A3)>0,MAX(B1,2),MIN(C1))"))).toEqual(["IF", "SUM", "MAX", "MIN"]);
  });
  it("checks arity", () => {
    expect(parseErr("=IF(1)").code).toBe("#ERROR!");
    expect(parseErr("=IF(1,2,3,4)").code).toBe("#ERROR!");
    expect(parseErr("=SUM()").code).toBe("#ERROR!");
    expect(() => p(`=SUM(${Array(255).fill("1").join(",")})`)).not.toThrow();
    expect(parseErr(`=SUM(${Array(256).fill("1").join(",")})`).message).toMatch(/at least 1/);
  });
  it("rejects empty arguments", () => {
    expect(parseErr("=SUM(1,)").code).toBe("#ERROR!");
    expect(parseErr("=IF(A1,,1)").code).toBe("#ERROR!");
  });
});

describe("parser: unsupported input is #NAME? with a clear message", () => {
  it.each([
    ["=MATCH(A1,B1:B5,0)", /MATCH is not available/],
    ["=VLOOKUP(A1,B1:C5,2,FALSE)", /VLOOKUP is not available/],
    ["=NOW()", /NOW is not available/],
    ['=INDIRECT("A1")', /INDIRECT is not available/],
    ["=Sheet1!A1", /Sheet references/],
    ["=#N/A", /Error literals/],
    ["={1,2,3}", /Array constants/],
    ["=Table1[Col]", /Structured/],
    ["=SUM(A1;A2)", /comma/],
    ["=A:A", /Whole-column/],
    ["=Reorder", /not a recognised name/],
    ["=@A1", /@ operator/],
    ["=ZZZZ1", /not a recognised name/],
  ])("%s", (f, msg) => {
    const e = parseErr(f);
    expect(e.code).toBe("#NAME?");
    expect(e.message).toMatch(msg);
  });
});

describe("parser: syntax errors are #ERROR!", () => {
  it.each(["=", "=1+", "=(1+2", "=1+2)", "=SUM(A1", "=A1:", "=A1:5", "=*2", "=1 2", '="abc'])("%s", (f) => {
    expect(parseErr(f).code).toBe("#ERROR!");
  });
});

describe("parser: depth", () => {
  it("measures AST depth", () => {
    expect(astDepth(p("=1"))).toBe(1);
    expect(astDepth(p("=1+2*3"))).toBe(3);
  });
  it("throws LimitError past the depth limit", () => {
    expect(() => parseFormula("=" + "(".repeat(31) + "1" + ")".repeat(31))).toThrow(LimitError);
    expect(() => parseFormula("=" + "-".repeat(40) + "1")).toThrow(LimitError);
    expect(() => parseFormula("=" + Array(40).fill("1").join("+"))).toThrow(LimitError);
    expect(() => parseFormula("=" + Array(30).fill("1").join("+"))).not.toThrow();
  });
});
