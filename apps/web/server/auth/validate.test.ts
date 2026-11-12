import { describe, expect, it } from "vitest";
import { cleanName, isEmail, normaliseEmail, passwordProblem, safeNext } from "./validate";

describe("safeNext (open-redirect guard)", () => {
  it("allows same-site paths and keeps the query", () => {
    expect(safeNext("/cockpit")).toBe("/cockpit");
    expect(safeNext("/missions/excel-sum-101?step=assessment")).toBe("/missions/excel-sum-101?step=assessment");
  });

  it.each([
    "//evil.example",
    "///evil.example",
    "https://evil.example",
    "http://evil.example/cockpit",
    "javascript:alert(1)",
    "/\\evil.example",
    "\\\\evil.example",
    "/ok\r\nSet-Cookie: x=1",
    "cockpit",
    "",
    "/" + "a".repeat(300),
  ])("rejects %j and falls back to /cockpit", (bad) => {
    expect(safeNext(bad)).toBe("/cockpit");
  });

  it("rejects non-strings and honours a custom fallback", () => {
    expect(safeNext(undefined)).toBe("/cockpit");
    expect(safeNext(["/a"])).toBe("/cockpit");
    expect(safeNext("//x", "/")).toBe("/");
  });
});

describe("email", () => {
  it("normalises case and surrounding space", () => {
    expect(normaliseEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normaliseEmail(42)).toBe("");
  });
  it("accepts ordinary addresses and rejects obvious junk", () => {
    expect(isEmail("ada@example.com")).toBe(true);
    expect(isEmail("godfrey.kariuki@bata.com")).toBe(true);
    for (const bad of ["", "ada", "ada@", "@example.com", "ada@example", "a b@example.com", "a@b@example.com", "<x>@example.com", "ada@example.c"]) {
      expect(isEmail(bad), bad).toBe(false);
    }
    expect(isEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("password rules for new accounts", () => {
  it("needs 10+ characters", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("123456789")).toMatch(/at least 10/);
    expect(passwordProblem("correct horse battery")).toBeNull();
  });
  it("stops at bcrypt's 72-byte limit (counts bytes, not characters)", () => {
    expect(passwordProblem("a1".repeat(36))).toBeNull(); // 72 bytes
    expect(passwordProblem("a1".repeat(36) + "x")).toMatch(/at most 72/);
    expect(passwordProblem("é".repeat(40))).toMatch(/at most 72/); // 80 bytes, only 40 characters
  });
  it("rejects one repeated character and non-strings", () => {
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/repeated/);
    expect(passwordProblem(undefined)).toMatch(/at least 10/);
  });
});

describe("cleanName", () => {
  it("strips control characters, collapses space and caps at 80", () => {
    expect(cleanName("  Ada\u0007   Lovelace \n")).toBe("Ada Lovelace");
    expect(cleanName("x".repeat(200))).toHaveLength(80);
    expect(cleanName(null)).toBe("");
  });
});
