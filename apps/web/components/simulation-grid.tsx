import { simulationSheet } from "@/lib/mock-data";

/**
 * NON-FUNCTIONAL placeholder for the Simulation step. It renders inert data only.
 * The formula engine is a separate spike; dynamic code execution (eval / new Function) is banned by lint.
 */
export function SimulationGrid() {
  const { columns, rows, targetCell } = simulationSheet;
  return (
    <div className="overflow-x-auto rounded-md border border-border-strong">
      <table className="w-full min-w-[20rem] border-collapse font-mono text-sm">
        <caption className="sr-only">
          Practice sheet. Cell {targetCell} is where your SUM formula will go.
        </caption>
        <thead>
          <tr className="bg-surface-2 text-fg-muted">
            <th scope="col" className="w-12 border-r border-b border-border-strong px-2 py-1.5 font-semibold">
              <span className="sr-only">Row</span>
            </th>
            {columns.map((c) => (
              <th key={c} scope="col" className="border-b border-border-strong px-3 py-1.5 text-left font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const rowNumber = r + 1;
            return (
              <tr key={rowNumber} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="border-r border-border-strong bg-surface-2 px-2 py-1.5 text-center font-semibold text-fg-muted"
                >
                  {rowNumber}
                </th>
                {row.map((value, c) => {
                  const ref = `${columns[c]}${rowNumber}`;
                  if (ref === targetCell) {
                    return (
                      <td key={ref} className="px-1 py-1">
                        <input
                          readOnly
                          aria-label={`Cell ${ref} (formula input, not active in this prototype)`}
                          aria-describedby="sim-note"
                          placeholder="=SUM(B2:B4)"
                          className="w-full rounded-sm border-2 border-accent bg-surface px-2 py-1 text-fg placeholder:text-fg-muted"
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={ref} className={c === 1 ? "px-3 py-1.5 text-right" : "px-3 py-1.5"}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p id="sim-note" className="border-t border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
        Prototype: the formula engine arrives in a later spike, so this cell does not calculate yet.
      </p>
    </div>
  );
}
