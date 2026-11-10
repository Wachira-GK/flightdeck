import { createWorkbook, type CellValue, type Limits } from "../src";

/** Evaluates one formula in Z100 with the given other cells. */
export function ev(formula: string, cells: Record<string, string> = {}, limits?: Partial<Limits>): CellValue {
  const wb = createWorkbook(limits);
  wb.setCells({ ...cells, Z100: formula });
  return wb.getValue("Z100");
}

/** Error code of a value, or undefined. */
export function code(v: CellValue): string | undefined {
  return typeof v === "object" && v !== null ? v.error : undefined;
}
