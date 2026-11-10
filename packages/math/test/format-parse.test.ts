import { describe, expect, it } from "vitest";
import { formatFixed, formatNumber, MAX_ANSWER_LENGTH, parseNumericAnswer, roundTo } from "../src";

describe("roundTo / formatNumber", () => {
  it("rounds half away from zero, avoiding binary artefacts", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(53.0748946720052, 2)).toBe(53.07);
    expect(Object.is(roundTo(-0.0001, 2), 0)).toBe(true);
    expect(roundTo(1e-7, 2)).toBe(0);
    expect(roundTo(1e21, 2)).toBe(1e21);
  });
  it("validates decimals and value", () => {
    expect(() => roundTo(1, -1)).toThrowError(/Decimals/);
    expect(() => roundTo(1, 1.5)).toThrowError(/Decimals/);
    expect(() => roundTo(NaN, 1)).toThrowError(/finite/);
  });
  it("formats with trimmed zeros, or fixed places", () => {
    expect(formatNumber(162.5)).toBe("162.5");
    expect(formatNumber(147)).toBe("147");
    expect(formatNumber(53.0748946720052, 1)).toBe("53.1");
    expect(formatNumber(-0.001, 2)).toBe("0");
    expect(formatNumber(-2.25, 1)).toBe("-2.3");
    expect(formatNumber(1234567.891, 2)).toBe("1234567.89");
    expect(formatFixed(147, 1)).toBe("147.0");
    expect(formatFixed(-0.01, 1)).toBe("0.0");
    expect(formatFixed(-1.25, 1)).toBe("-1.3");
  });
});

describe("parseNumericAnswer (locale-safe)", () => {
  it.each([
    ["3.5", 3.5],
    ["  42 ", 42],
    ["-3.5", -3.5],
    ["−3.5", -3.5], // Unicode minus sign
    ["–3.5", -3.5], // en dash from autocorrect
    ["+7", 7],
    [".5", 0.5],
    ["5.", 5],
    ["0", 0],
    ["-0", 0],
    ["162.50", 162.5],
  ])("accepts %j", (input, value) => {
    const r = parseNumericAnswer(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.is(r.value, value)).toBe(true);
  });

  it("rejects a decimal comma with a helpful message", () => {
    const r = parseNumericAnswer("3,5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("type 3.5 (not 3,5)");
  });

  it.each([
    ["1,234", /thousands separators/],
    ["", /Enter a number/],
    ["   ", /Enter a number/],
    ["1 234", /spaces/],
    ["50%", /% sign/],
    ["1e3", /scientific/],
    ["abc", /not a number/],
    ["1.2.3", /not a number/],
    ["Infinity", /not a number/],
    ["NaN", /not a number/],
    ["--3", /not a number/],
    ["0x10", /not a number/],
    ["1".repeat(MAX_ANSWER_LENGTH + 1), /too long/],
  ])("rejects %j", (input, message) => {
    const r = parseNumericAnswer(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(message);
  });

  it("rejects non-string input defensively", () => {
    expect(parseNumericAnswer(5 as unknown as string).ok).toBe(false);
  });
});
