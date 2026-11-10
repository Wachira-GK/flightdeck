import { evaluateAst } from "./evaluator";
import { collectReferences, parseFormula, type AstNode } from "./parser";
import { compareKeys, gridLabel, isInGrid, normalizeRef, toKey } from "./refs";
import {
  cellError,
  EngineError,
  LimitError,
  resolveLimits,
  type CellError,
  type CellValue,
  type Limits,
} from "./types";
import { formatValue, parseConstant } from "./values";

interface CellRecord {
  input: string;
  /** Parsed formula, or undefined for constants and formulas with a static error. */
  ast?: AstNode;
  /** Error found before evaluation (parse, #NAME?, #LIMIT!). */
  staticError?: CellError;
  /** Constant value for non-formula cells. */
  constant?: number | string | boolean;
  /** Sorted, de-duplicated precedent keys (ranges expanded). */
  precedents: string[];
}

export interface RecalcResult {
  /** Formula cells recalculated, in evaluation (topological) order. */
  recalculated: string[];
}

export interface Workbook {
  readonly limits: Readonly<Limits>;
  /**
   * Sets a cell. Input starting with "=" is a formula; "" clears the cell. Recalculates only the
   * cell and its transitive dependents. Throws RangeError for a malformed reference and
   * LimitError when the reference is outside the grid or the non-empty cell limit is reached.
   * Formula-level limit breaches do not throw: the cell holds #LIMIT!.
   */
  setCell(ref: string, input: string): RecalcResult;
  /** Sets many cells, then recalculates once. Same error behaviour as setCell. */
  setCells(cells: Record<string, string>): RecalcResult;
  getValue(ref: string): CellValue;
  getDisplay(ref: string): string;
  getInput(ref: string): string;
  /** Values of all non-empty cells, keyed canonically in row-major order. */
  snapshot(): Record<string, CellValue>;
  /** Inputs of all non-empty cells, row-major. */
  inputs(): Record<string, string>;
  precedentsOf(ref: string): string[];
  dependentsOf(ref: string): string[];
  stats(): { cells: number; edges: number };
}

/** Iterative Tarjan SCC. Emits components so that precedents come before dependents. */
function stronglyConnected(nodes: string[], succ: (n: string) => string[]): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  for (const root of nodes) {
    if (idx.has(root)) continue;
    const work: { node: string; i: number; succs: string[] }[] = [];
    const push = (n: string) => {
      idx.set(n, index);
      low.set(n, index);
      index++;
      stack.push(n);
      onStack.add(n);
      work.push({ node: n, i: 0, succs: succ(n) });
    };
    push(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.i < frame.succs.length) {
        const w = frame.succs[frame.i++]!;
        if (!idx.has(w)) push(w);
        else if (onStack.has(w)) low.set(frame.node, Math.min(low.get(frame.node)!, idx.get(w)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === idx.get(frame.node)) {
        const scc: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
          if (w === frame.node) break;
        }
        out.push(scc);
      }
    }
  }
  return out;
}

class WorkbookImpl implements Workbook {
  readonly limits: Readonly<Limits>;
  private readonly cells = new Map<string, CellRecord>();
  private readonly values = new Map<string, CellValue>();
  private readonly dependents = new Map<string, Set<string>>();
  private edges = 0;

  constructor(limits?: Partial<Limits>) {
    this.limits = Object.freeze(resolveLimits(limits));
  }

  private key(ref: string): string {
    if (typeof ref !== "string") throw new RangeError("Cell reference must be text");
    return normalizeRef(ref, this.limits);
  }

  setCell(ref: string, input: string): RecalcResult {
    const key = this.key(ref);
    this.assign(key, input);
    return this.recalc([key]);
  }

  setCells(cells: Record<string, string>): RecalcResult {
    const entries = Object.entries(cells).map(([ref, input]) => [this.key(ref), input] as const);
    entries.sort((a, b) => compareKeys(a[0], b[0]));
    const done: string[] = [];
    try {
      for (const [key, input] of entries) {
        this.assign(key, input);
        done.push(key);
      }
    } catch (e) {
      // Keep the sheet consistent for the cells that were accepted, then report the breach.
      this.recalc(done);
      throw e;
    }
    return this.recalc(done);
  }

  /** Stores a cell without recalculating. */
  assign(key: string, input: string): void {
    if (typeof input !== "string") throw new TypeError("Cell input must be text");
    if (input === "") {
      this.unregister(key);
      this.cells.delete(key);
      this.values.delete(key);
      return;
    }
    if (!this.cells.has(key) && this.cells.size >= this.limits.maxCells) {
      throw new LimitError("cells", `The sheet already has ${this.limits.maxCells} non-empty cells (the limit)`);
    }
    this.unregister(key);
    const rec = this.build(input);
    this.cells.set(key, rec);
    for (const p of rec.precedents) {
      let set = this.dependents.get(p);
      if (!set) {
        set = new Set();
        this.dependents.set(p, set);
      }
      set.add(key);
    }
    this.edges += rec.precedents.length;
    if (rec.ast === undefined) {
      this.values.set(key, rec.staticError ?? rec.constant ?? null);
    }
  }

  private unregister(key: string): void {
    const old = this.cells.get(key);
    if (!old) return;
    for (const p of old.precedents) {
      const set = this.dependents.get(p);
      if (set) {
        set.delete(key);
        if (set.size === 0) this.dependents.delete(p);
      }
    }
    this.edges -= old.precedents.length;
  }

  private build(input: string): CellRecord {
    const L = this.limits;
    if (!input.startsWith("=")) {
      if (input.length > L.maxStringLength) {
        return {
          input,
          precedents: [],
          staticError: cellError("#LIMIT!", `Text is longer than ${L.maxStringLength} characters`),
        };
      }
      return { input, precedents: [], constant: parseConstant(input) };
    }
    let ast: AstNode;
    try {
      ast = parseFormula(input, { limits: L });
    } catch (e) {
      const err =
        e instanceof EngineError ? cellError(e.code, e.message) : cellError("#ERROR!", "The formula could not be read");
      return { input, precedents: [], staticError: err };
    }
    const budget = L.maxEdges - this.edges;
    const precedents = new Set<string>();
    for (const r of collectReferences(ast)) {
      const start = r.type === "ref" ? r.ref : r.start;
      const end = r.type === "ref" ? r.ref : r.end;
      if (!isInGrid(start, L) || !isInGrid(end, L)) {
        const shown = r.type === "ref" ? toKey(r.ref) : `${toKey(r.start)}:${toKey(r.end)}`;
        return {
          input,
          precedents: [],
          staticError: cellError("#LIMIT!", `${shown} is outside the practice grid ${gridLabel(L)}`),
        };
      }
      for (let row = start.row; row <= end.row; row++) {
        for (let col = start.col; col <= end.col; col++) {
          precedents.add(toKey({ row, col }));
          if (precedents.size > budget) {
            return {
              input,
              precedents: [],
              staticError: cellError(
                "#LIMIT!",
                `The sheet would have more than ${L.maxEdges} cell references in total (the limit)`,
              ),
            };
          }
        }
      }
    }
    return { input, ast, precedents: [...precedents].sort(compareKeys) };
  }

  /** Recalculates the changed cells' formula dependents (and changed formulas) in topological order. */
  recalc(changed: string[]): RecalcResult {
    const affected = new Set<string>();
    const queue: string[] = [];
    for (const k of changed) {
      if (this.isFormula(k)) affected.add(k);
      queue.push(k);
    }
    const seen = new Set<string>(changed);
    while (queue.length > 0) {
      const k = queue.pop()!;
      const deps = this.dependents.get(k);
      if (!deps) continue;
      for (const d of deps) {
        if (seen.has(d)) continue;
        seen.add(d);
        affected.add(d);
        queue.push(d);
      }
    }
    const nodes = [...affected].sort(compareKeys);
    const succ = (n: string) => (this.cells.get(n)?.precedents ?? []).filter((p) => affected.has(p));
    const order: string[] = [];
    const ctx = {
      getCell: (k: string): CellValue => this.values.get(k) ?? null,
      maxStringLength: this.limits.maxStringLength,
    };
    for (const scc of stronglyConnected(nodes, succ)) {
      const first = scc[0]!;
      const selfLoop = scc.length === 1 && (this.cells.get(first)?.precedents.includes(first) ?? false);
      if (scc.length > 1 || selfLoop) {
        const members = [...scc].sort(compareKeys);
        const msg = selfLoop
          ? `Circular reference: ${first} refers to itself`
          : `Circular reference: ${members.join(", ")} refer to each other`;
        for (const k of members) {
          this.values.set(k, cellError("#CIRC!", msg));
          order.push(k);
        }
        continue;
      }
      const rec = this.cells.get(first);
      if (!rec) continue;
      order.push(first);
      if (rec.ast === undefined) {
        this.values.set(first, rec.staticError ?? rec.constant ?? null);
        continue;
      }
      this.values.set(first, evaluateAst(rec.ast, ctx));
    }
    return { recalculated: order };
  }

  private isFormula(k: string): boolean {
    return this.cells.get(k)?.input.startsWith("=") ?? false;
  }

  getValue(ref: string): CellValue {
    return this.values.get(this.key(ref)) ?? null;
  }

  getDisplay(ref: string): string {
    return formatValue(this.getValue(ref));
  }

  getInput(ref: string): string {
    return this.cells.get(this.key(ref))?.input ?? "";
  }

  snapshot(): Record<string, CellValue> {
    const out: Record<string, CellValue> = {};
    for (const k of [...this.cells.keys()].sort(compareKeys)) out[k] = this.values.get(k) ?? null;
    return out;
  }

  inputs(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of [...this.cells.keys()].sort(compareKeys)) out[k] = this.cells.get(k)!.input;
    return out;
  }

  precedentsOf(ref: string): string[] {
    return [...(this.cells.get(this.key(ref))?.precedents ?? [])];
  }

  dependentsOf(ref: string): string[] {
    return [...(this.dependents.get(this.key(ref)) ?? [])].sort(compareKeys);
  }

  stats(): { cells: number; edges: number } {
    return { cells: this.cells.size, edges: this.edges };
  }
}

export function createWorkbook(limits?: Partial<Limits>): Workbook {
  return new WorkbookImpl(limits);
}

/**
 * Evaluates a whole sheet from scratch (used by the Worker and the server validator).
 * Never throws for bad cells: malformed refs get #REF!, out-of-grid refs and the cell limit get #LIMIT!.
 */
export function evaluateSheet(cells: Record<string, string>, limits?: Partial<Limits>): Record<string, CellValue> {
  const wb = new WorkbookImpl(limits);
  const out: Record<string, CellValue> = {};
  const accepted: string[] = [];
  const keyed: [string, string, string][] = [];
  for (const [ref, input] of Object.entries(cells)) {
    try {
      keyed.push([ref, normalizeRef(ref, wb.limits), input]);
    } catch (e) {
      out[ref] =
        e instanceof LimitError ? cellError("#LIMIT!", e.message) : cellError("#REF!", `Invalid cell reference ${ref.slice(0, 20)}`);
    }
  }
  keyed.sort((a, b) => compareKeys(a[1], b[1]));
  for (const [ref, key, input] of keyed) {
    try {
      wb.assign(key, typeof input === "string" ? input : String(input));
      accepted.push(key);
    } catch (e) {
      out[ref] = e instanceof LimitError ? cellError("#LIMIT!", e.message) : cellError("#ERROR!", "Invalid cell input");
    }
  }
  // Recalculate everything once, in topological order.
  wb.recalc(accepted);
  for (const [ref, key] of keyed) {
    if (!(ref in out)) out[key] = wb.getValue(key);
  }
  return out;
}
