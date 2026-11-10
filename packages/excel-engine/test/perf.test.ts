import { describe, expect, it } from "vitest";
import { columnToLetters, createWorkbook, evaluateSheet } from "../src";

/**
 * A realistic full sheet: 500 non-empty cells (the limit) in 25 columns x 20 rows.
 * Columns A..L are inputs; M..Y are formulas mixing SUM/AVERAGE/IF/arithmetic and chained refs,
 * staying under the 5000-edge budget.
 */
function fullSheet(): Record<string, string> {
  const cells: Record<string, string> = {};
  for (let r = 1; r <= 20; r++) {
    for (let c = 0; c < 12; c++) cells[`${columnToLetters(c)}${r}`] = String(((r * 31 + c * 17) % 97) + 1);
    for (let c = 12; c < 25; c++) {
      const col = columnToLetters(c);
      const prev = columnToLetters(c - 1);
      const k = `${col}${r}`;
      switch (c % 4) {
        case 0:
          cells[k] = `=SUM(A${r}:L${r})+${prev}${r}`;
          break;
        case 1:
          cells[k] = `=AVERAGE(A${r}:L${Math.min(r + 1, 20)})*2-${prev}${r}`;
          break;
        case 2:
          cells[k] = `=IF(${prev}${r}>100,${prev}${r}/2,MAX(A${r}:F${r})^2)`;
          break;
        default:
          cells[k] = `=${prev}${r}&""&COUNT(A${r}:L${r})`;
      }
    }
  }
  return cells;
}

describe("performance (target <= 100 ms; asserted < 400 ms for CI margin)", () => {
  const sheet = fullSheet();

  it("builds a 500-cell sheet", () => {
    const wb = createWorkbook();
    wb.setCells(sheet);
    expect(wb.stats().cells).toBe(500);
    expect(wb.stats().edges).toBeLessThanOrEqual(5000);
  });

  it("full recalculation of the 500-cell sheet", () => {
    evaluateSheet(sheet); // warm up the JIT
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      evaluateSheet(sheet);
      runs.push(performance.now() - t0);
    }
    const median = [...runs].sort((a, b) => a - b)[2]!;
    console.info(`[perf] full 500-cell evaluation: median ${median.toFixed(2)} ms (runs: ${runs.map((r) => r.toFixed(2)).join(", ")})`);
    expect(median).toBeLessThan(400);
  });

  it("incremental recalculation after one input change touches only dependents", () => {
    const wb = createWorkbook();
    wb.setCells(sheet);
    const t0 = performance.now();
    const r = wb.setCell("A20", "999");
    const ms = performance.now() - t0;
    console.info(`[perf] incremental edit of A20: ${r.recalculated.length} cells in ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(400);
    expect(r.recalculated.length).toBeLessThan(500 - 240);
    // Only rows 19 (AVERAGE over rows 19-20) and 20 can depend on A20.
    expect(r.recalculated.every((k) => k.endsWith("19") || k.endsWith("20"))).toBe(true);
    expect(wb.snapshot()).toEqual(evaluateSheet(wb.inputs()));
  });
});
