"use client";

import {
  buildSubmission,
  exerciseLimits,
  formatValue,
  isCellError,
  type CellValue,
  type ExerciseDefinition,
  type ExerciseKey,
  type Submission,
  type ValidationResult,
} from "@flightdeck/excel-engine";
import { Badge, Button, cn } from "@flightdeck/ui";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  createBrowserEngineWorker,
  createEngineClient,
  EngineTimeoutError,
  type EngineClient,
} from "./engine-client";
import {
  applyEdit,
  cellAlign,
  cellAriaLabel,
  checkSummary,
  firstEditable,
  isTypingKey,
  moveSelection,
  posToKey,
  type GridPos,
} from "./grid-helpers";
import { HARD_TIMEOUT_MS } from "./protocol";

export interface ExcelGridProps {
  /** Learner-safe exercise definition (content/excel/exercises/<id>.json). */
  exercise: ExerciseDefinition;
  /**
   * PRACTICE ONLY. The server-only answer key (<id>.key.json). Passing it ships the answers to the
   * browser, so use it only while server grading is unavailable. Without it, "Check my work" runs a
   * structure-only practice check.
   */
  practiceKey?: ExerciseKey;
  /** Called after each practice check with the result and the submission that was checked. */
  onCheck?: (result: ValidationResult, submission: Submission) => void;
  className?: string;
}

type CalcState = "busy" | "idle" | "timeout" | "crashed";

interface EditState {
  source: "cell" | "bar";
  draft: string;
}

const ALIGN_CLASS = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Interactive Excel practice grid. Formulas run in a Web Worker (TB7) with a 500 ms hard timeout;
 * the result of "Check my work" is a local practice check, never the official verdict.
 */
export function ExcelGrid({ exercise, practiceKey, onCheck, className }: ExcelGridProps) {
  const uid = useId();
  const size = exercise.grid;
  const editable = useMemo(() => new Set(exercise.editableCells), [exercise.editableCells]);
  const limits = useMemo(() => exerciseLimits(exercise), [exercise]);
  const timeoutMs = Math.min(exercise.timeoutMs ?? HARD_TIMEOUT_MS, HARD_TIMEOUT_MS);

  const [inputs, setInputs] = useState<Record<string, string>>(() => ({ ...exercise.starter }));
  const [values, setValues] = useState<Record<string, CellValue>>({});
  const [calc, setCalc] = useState<CalcState>("busy");
  const [sel, setSel] = useState<GridPos>(() => firstEditable(exercise.editableCells, size));
  const [edit, setEdit] = useState<EditState | null>(null);
  const [check, setCheck] = useState<ValidationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const clientRef = useRef<EngineClient | null>(null);
  const requestRef = useRef(0);
  const focusCellRef = useRef(false);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  /** True while an edit is open; guards blur-commits that fire after Enter/Escape already ended it. */
  const editActiveRef = useRef(false);
  const barRef = useRef<HTMLInputElement | null>(null);

  const selKey = posToKey(sel);
  const selEditable = editable.has(selKey);
  const selInput = inputs[selKey] ?? "";
  const selValue = values[selKey] ?? null;

  const getClient = useCallback((): EngineClient => {
    if (!clientRef.current) {
      clientRef.current = createEngineClient({ createWorker: createBrowserEngineWorker, timeoutMs });
    }
    return clientRef.current;
  }, [timeoutMs]);

  const handleEngineError = useCallback((err: unknown) => {
    const timedOut = err instanceof EngineTimeoutError;
    setCalc(timedOut ? "timeout" : "crashed");
    setAnnouncement(
      timedOut
        ? "The calculation took too long and was stopped. Undo your last change or reset the sheet."
        : "The calculation engine stopped. Reset the sheet to try again.",
    );
  }, []);

  const recalc = useCallback(
    (next: Record<string, string>) => {
      const id = ++requestRef.current;
      setCalc("busy");
      getClient()
        .evaluate(next, limits)
        .then((v) => {
          if (id !== requestRef.current) return;
          setValues(v);
          setCalc("idle");
        })
        .catch((err: unknown) => {
          if (id === requestRef.current) handleEngineError(err);
        });
    },
    [getClient, limits, handleEngineError],
  );

  // Start the Worker and compute the starter sheet; stop the Worker on unmount.
  useEffect(() => {
    const client = createEngineClient({ createWorker: createBrowserEngineWorker, timeoutMs });
    clientRef.current = client;
    const id = ++requestRef.current;
    client
      .evaluate({ ...exercise.starter }, limits)
      .then((v) => {
        if (id !== requestRef.current) return;
        setValues(v);
        setCalc("idle");
      })
      .catch((err: unknown) => {
        if (id === requestRef.current) handleEngineError(err);
      });
    return () => {
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [exercise.starter, limits, timeoutMs, handleEngineError]);

  // Move DOM focus with the roving tabindex, but only after keyboard/mouse interaction in the grid.
  useEffect(() => {
    if (!edit && focusCellRef.current) {
      focusCellRef.current = false;
      cellRefs.current.get(selKey)?.focus();
    }
  }, [selKey, edit]);

  /** Focuses the in-cell editor as soon as it mounts, caret at the end. */
  const focusEditor = useCallback((el: HTMLInputElement | null) => {
    if (el && el.ownerDocument.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const select = (pos: GridPos) => {
    focusCellRef.current = true;
    setSel(pos);
  };

  const beginEdit = (source: EditState["source"], draft: string) => {
    if (!selEditable) {
      setAnnouncement(`${selKey} is locked. Only the outlined cells can be changed.`);
      return;
    }
    editActiveRef.current = true;
    setEdit({ source, draft });
  };

  const commit = (move?: "down" | "right") => {
    if (!edit || !editActiveRef.current) return;
    editActiveRef.current = false;
    const next = applyEdit(inputs, selKey, edit.draft);
    setEdit(null);
    focusCellRef.current = true;
    if ((inputs[selKey] ?? "") !== edit.draft) {
      setInputs(next);
      setCheck(null);
      recalc(next);
    }
    if (move) {
      const target = moveSelection(sel, { key: move === "down" ? "ArrowDown" : "ArrowRight" }, size);
      if (target) setSel(target);
    }
  };

  const cancel = () => {
    editActiveRef.current = false;
    setEdit(null);
    focusCellRef.current = true;
  };

  const clearSelected = () => {
    if (!selEditable) {
      setAnnouncement(`${selKey} is locked. Only the outlined cells can be changed.`);
      return;
    }
    if (!inputs[selKey]) return;
    const next = applyEdit(inputs, selKey, "");
    setInputs(next);
    setCheck(null);
    recalc(next);
  };

  const onCellKeyDown = (e: KeyboardEvent<HTMLTableCellElement>) => {
    if (edit || editActiveRef.current) {
      // Keys typed before the in-cell editor took focus still belong to the edit.
      if (isTypingKey(e)) {
        e.preventDefault();
        setEdit((cur) => (cur ? { ...cur, draft: cur.draft + e.key } : cur));
      }
      return;
    }
    const target = moveSelection(sel, e, size);
    if (target) {
      e.preventDefault();
      select(target);
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      beginEdit("cell", selInput);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearSelected();
      return;
    }
    if (isTypingKey(e)) {
      e.preventDefault();
      beginEdit("cell", e.key);
    }
  };

  const onEditorKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(edit?.source === "cell" ? "down" : undefined);
    } else if (e.key === "Tab" && edit?.source === "cell") {
      e.preventDefault();
      commit("right");
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const reset = () => {
    const starter = { ...exercise.starter };
    setInputs(starter);
    editActiveRef.current = false;
    setEdit(null);
    setCheck(null);
    recalc(starter);
    setAnnouncement("The sheet was reset to its starting values.");
  };

  const runCheck = () => {
    const submission = buildSubmission(exercise, inputs);
    setChecking(true);
    getClient()
      .validate(exercise, submission, practiceKey)
      .then((result) => {
        setCheck(result);
        const passedCount = result.checks.filter((c) => c.passed).length;
        setAnnouncement(`Practice check: ${checkSummary(passedCount, result.checks.length, result.score, result.passed)}`);
        onCheck?.(result, submission);
      })
      .catch(handleEngineError)
      .finally(() => setChecking(false));
  };

  const rows = Array.from({ length: size.rows }, (_, r) => r);
  const cols = Array.from({ length: size.cols }, (_, c) => c);
  const barValue = edit ? edit.draft : selInput;
  const barId = `${uid}-bar`;
  const errorId = `${uid}-error`;
  const legendId = `${uid}-legend`;
  const engineDown = calc === "timeout" || calc === "crashed";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Formula bar */}
      <div className="flex items-stretch overflow-hidden rounded-md border border-border-strong bg-surface font-mono text-sm">
        <output
          aria-label="Selected cell"
          className="flex w-16 shrink-0 items-center justify-center border-r border-border-strong bg-surface-2 px-2 font-semibold text-fg"
        >
          {selKey}
        </output>
        <span aria-hidden="true" className="flex items-center border-r border-border-strong px-2 text-fg-muted italic">
          fx
        </span>
        <label htmlFor={barId} className="sr-only">
          {`Formula bar for ${selKey}${selEditable ? "" : " (locked)"}`}
        </label>
        <input
          id={barId}
          ref={barRef}
          value={barValue}
          readOnly={!selEditable}
          aria-describedby={isCellError(selValue) ? errorId : undefined}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => {
            if (selEditable && !edit) beginEdit("bar", selInput);
          }}
          onChange={(e) => setEdit({ source: "bar", draft: e.target.value })}
          onKeyDown={onEditorKeyDown}
          onBlur={() => {
            if (edit?.source === "bar") commit();
          }}
          className="min-w-0 flex-1 bg-surface px-2 py-1.5 text-fg read-only:text-fg-muted"
        />
      </div>

      {isCellError(selValue) ? (
        <p id={errorId} className="text-sm text-danger">
          <span className="font-mono font-semibold">{selValue.error}</span> in {selKey}: {selValue.message}
        </p>
      ) : null}

      {engineDown ? (
        <div role="alert" className="rounded-md border border-danger bg-surface px-3 py-2 text-sm text-danger">
          {calc === "timeout"
            ? `The calculation took longer than ${timeoutMs} ms, so it was stopped. Undo your last change or reset the sheet.`
            : "The calculation engine stopped unexpectedly. Reset the sheet to try again."}
        </div>
      ) : null}

      {/* Grid */}
      <div className="overflow-x-auto rounded-md border border-border-strong">
        <table
          role="grid"
          aria-label={`${exercise.title} practice sheet`}
          aria-describedby={legendId}
          aria-rowcount={size.rows + 1}
          aria-colcount={size.cols + 1}
          aria-busy={calc === "busy"}
          className="w-full min-w-[20rem] border-collapse font-mono text-sm"
        >
          <thead>
            <tr role="row" aria-rowindex={1} className="bg-surface-2 text-fg-muted">
              <th role="columnheader" aria-colindex={1} className="w-12 border-r border-b border-border-strong px-2 py-1.5">
                <span className="sr-only">Row</span>
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  role="columnheader"
                  aria-colindex={c + 2}
                  className="min-w-24 border-r border-b border-border-strong px-3 py-1.5 text-center font-semibold last:border-r-0"
                >
                  {posToKey({ row: 0, col: c }).replace(/\d+$/, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r} role="row" aria-rowindex={r + 2} className="border-b border-border-strong last:border-b-0">
                <th
                  role="rowheader"
                  aria-colindex={1}
                  className="border-r border-border-strong bg-surface-2 px-2 py-1.5 text-center font-semibold text-fg-muted"
                >
                  {r + 1}
                </th>
                {cols.map((c) => {
                  const key = posToKey({ row: r, col: c });
                  const isSel = key === selKey;
                  const isEditable = editable.has(key);
                  const input = inputs[key] ?? "";
                  const value = values[key] ?? null;
                  const isEditingHere = isSel && edit?.source === "cell";
                  return (
                    <td
                      key={key}
                      ref={(el) => {
                        if (el) cellRefs.current.set(key, el);
                        else cellRefs.current.delete(key);
                      }}
                      role="gridcell"
                      aria-colindex={c + 2}
                      aria-selected={isSel}
                      aria-readonly={!isEditable}
                      aria-label={cellAriaLabel(key, input, value, isEditable)}
                      tabIndex={isSel && !isEditingHere ? 0 : -1}
                      onKeyDown={onCellKeyDown}
                      onClick={() => {
                        if (!isSel) select({ row: r, col: c });
                      }}
                      onDoubleClick={() => {
                        if (isEditable && isSel) beginEdit("cell", input);
                      }}
                      className={cn(
                        "h-9 border-r border-border-strong px-3 py-1 whitespace-nowrap last:border-r-0",
                        "cursor-cell outline-offset-[-3px]",
                        isEditable
                          ? "bg-surface shadow-[inset_0_0_0_2px_var(--fd-accent)]"
                          : "bg-surface-2 text-fg",
                        isSel && "outline-3 outline-focus",
                        ALIGN_CLASS[cellAlign(value)],
                        isCellError(value) && "font-semibold text-danger",
                      )}
                    >
                      {isEditingHere ? (
                        <input
                          ref={focusEditor}
                          aria-label={`Edit ${key}`}
                          value={edit.draft}
                          spellCheck={false}
                          autoComplete="off"
                          onChange={(e) => setEdit({ source: "cell", draft: e.target.value })}
                          onKeyDown={onEditorKeyDown}
                          onBlur={() => {
                            if (edit?.source === "cell") commit();
                          }}
                          className="w-full min-w-0 bg-surface px-0 text-left text-fg outline-none"
                        />
                      ) : (
                        <span aria-hidden="true">{formatValue(value)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p id={legendId} className="text-xs text-fg-muted">
        Outlined cells are editable; shaded cells are locked. Use the arrow keys to move, Enter or F2 to edit, Escape
        to cancel. Formulas start with =. Available functions: {exercise.allowedFunctions.join(", ") || "none"}.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={runCheck} disabled={checking || calc === "busy"}>
          {checking ? "Checking..." : "Check my work"}
        </Button>
        <Button variant="secondary" onClick={reset}>
          Reset
        </Button>
        <Badge tone="muted">Practice check</Badge>
        {calc === "busy" ? <span className="text-xs text-fg-muted">Calculating...</span> : null}
      </div>

      {check ? (
        <section aria-labelledby={`${uid}-check`} className="rounded-md border border-border-strong bg-surface p-4 text-sm">
          <h3 id={`${uid}-check`} className={cn("font-semibold", check.passed ? "text-success" : "text-fg")}>
            Practice check:{" "}
            {checkSummary(
              check.checks.filter((c) => c.passed).length,
              check.checks.length,
              check.score,
              check.passed,
            )}
          </h3>
          {check.rejected ? <p className="mt-1 text-danger">{check.rejected.message}</p> : null}
          <ul className="mt-2 flex flex-col gap-1">
            {check.checks.map((c) => (
              <li key={c.id} className={c.passed ? "text-success" : "text-danger"}>
                <span className="font-semibold">{c.passed ? "Pass" : "Not yet"}:</span>{" "}
                <span className="text-fg">{c.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-muted">
            {check.mode === "structure-only"
              ? "This practice check only confirms your cells calculate. "
              : "This is a practice check run in your browser. "}
            Your official result will come from the server.
          </p>
        </section>
      ) : null}

      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>
    </div>
  );
}
