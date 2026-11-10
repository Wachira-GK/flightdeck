import { describe, expect, it } from "vitest";
import {
  applyEdit,
  cellAlign,
  cellAriaLabel,
  checkSummary,
  firstEditable,
  isTypingKey,
  moveSelection,
  posToKey,
} from "./grid-helpers";

const SIZE = { rows: 5, cols: 3 };

describe("moveSelection", () => {
  it("moves with arrows and clamps at the edges", () => {
    expect(moveSelection({ row: 1, col: 1 }, { key: "ArrowUp" }, SIZE)).toEqual({ row: 0, col: 1 });
    expect(moveSelection({ row: 1, col: 1 }, { key: "ArrowDown" }, SIZE)).toEqual({ row: 2, col: 1 });
    expect(moveSelection({ row: 1, col: 1 }, { key: "ArrowLeft" }, SIZE)).toEqual({ row: 1, col: 0 });
    expect(moveSelection({ row: 1, col: 1 }, { key: "ArrowRight" }, SIZE)).toEqual({ row: 1, col: 2 });
    expect(moveSelection({ row: 0, col: 0 }, { key: "ArrowUp" }, SIZE)).toEqual({ row: 0, col: 0 });
    expect(moveSelection({ row: 4, col: 2 }, { key: "ArrowRight" }, SIZE)).toEqual({ row: 4, col: 2 });
  });
  it("supports Home/End, Ctrl+arrows, Ctrl+Home/End and paging", () => {
    expect(moveSelection({ row: 2, col: 1 }, { key: "Home" }, SIZE)).toEqual({ row: 2, col: 0 });
    expect(moveSelection({ row: 2, col: 1 }, { key: "End" }, SIZE)).toEqual({ row: 2, col: 2 });
    expect(moveSelection({ row: 2, col: 1 }, { key: "Home", ctrlKey: true }, SIZE)).toEqual({ row: 0, col: 0 });
    expect(moveSelection({ row: 2, col: 1 }, { key: "End", metaKey: true }, SIZE)).toEqual({ row: 4, col: 2 });
    expect(moveSelection({ row: 2, col: 1 }, { key: "ArrowDown", ctrlKey: true }, SIZE)).toEqual({ row: 4, col: 1 });
    expect(moveSelection({ row: 2, col: 1 }, { key: "PageUp" }, SIZE)).toEqual({ row: 0, col: 1 });
  });
  it("ignores other keys", () => {
    expect(moveSelection({ row: 0, col: 0 }, { key: "a" }, SIZE)).toBeNull();
    expect(moveSelection({ row: 0, col: 0 }, { key: "Enter" }, SIZE)).toBeNull();
  });
});

describe("cellAriaLabel", () => {
  it("announces key, formula, value and editability", () => {
    expect(cellAriaLabel("B3", "=SUM(B1:B2)", 5, true)).toBe("B3, formula =SUM(B1:B2), value 5, editable");
    expect(cellAriaLabel("A1", "Month", "Month", false)).toBe("A1, value Month, locked");
    expect(cellAriaLabel("C5", "", null, true)).toBe("C5, empty, editable");
  });
  it("includes the error explanation", () => {
    expect(cellAriaLabel("B5", "=1/0", { error: "#DIV/0!", message: "Division by zero" }, true)).toBe(
      "B5, formula =1/0, error #DIV/0!: Division by zero, editable",
    );
  });
});

describe("misc helpers", () => {
  it("posToKey", () => {
    expect(posToKey({ row: 0, col: 0 })).toBe("A1");
    expect(posToKey({ row: 99, col: 29 })).toBe("AD100");
  });
  it("isTypingKey", () => {
    expect(isTypingKey({ key: "=" })).toBe(true);
    expect(isTypingKey({ key: "a", ctrlKey: true })).toBe(false);
    expect(isTypingKey({ key: "ArrowUp" })).toBe(false);
  });
  it("cellAlign follows Excel", () => {
    expect(cellAlign(3)).toBe("right");
    expect(cellAlign("x")).toBe("left");
    expect(cellAlign(null)).toBe("left");
    expect(cellAlign(true)).toBe("center");
    expect(cellAlign({ error: "#NAME?", message: "" })).toBe("center");
  });
  it("firstEditable picks the first editable cell in row-major order", () => {
    expect(firstEditable(["C5", "B5"], SIZE)).toEqual({ row: 4, col: 1 });
    expect(firstEditable(["Z9"], SIZE)).toEqual({ row: 0, col: 0 });
    expect(firstEditable([], SIZE)).toEqual({ row: 0, col: 0 });
  });
  it("applyEdit sets and clears without mutating", () => {
    const base = { A1: "1" };
    expect(applyEdit(base, "B1", "=A1")).toEqual({ A1: "1", B1: "=A1" });
    expect(applyEdit(base, "A1", "")).toEqual({});
    expect(base).toEqual({ A1: "1" });
  });
  it("checkSummary", () => {
    expect(checkSummary(4, 4, 100, true)).toBe("All 4 checks passed. Score 100.");
    expect(checkSummary(1, 4, 25, false)).toBe("1 of 4 checks passed. Score 25.");
  });
});
