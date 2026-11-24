"use client";

// No-code mission editor (ADR-015, stage 2c). Holds the author's EditorDoc in state and posts it to a server action as one
// hidden field. It never computes answers: the server turns the solution into the answer key and runs every check.
import { useState } from "react";
import { Button, Card } from "@flightdeck/ui";
import {
  BLOCK_LABELS,
  colName,
  expandCells,
  STEP_TITLES,
  type AuthorLevel,
  type EditorDoc,
  type EditorQuestion,
  type EditorStep,
} from "@/lib/author/doc";
import type { ExcelMissionBlock } from "@/components/excel/missions";

const input = "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm";
const area = `${input} min-h-20`;
const lab = "block text-sm font-medium";
const small = "text-sm text-fg-muted";

type Block = ExcelMissionBlock;
const NEW_BLOCKS: Record<Exclude<Block["type"], "excel-grid" | "exercise-hints" | "assessment-items">, Block> = {
  paragraph: { type: "paragraph", text: "" },
  list: { type: "list", items: [""] },
  formula: { type: "formula", formula: "=", text: "" },
  table: { type: "table", caption: "", columns: ["Column 1", "Column 2"], rows: [["", ""]] },
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={lab}>{label}</span>
      {hint ? <span className={`block ${small}`}>{hint}</span> : null}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export function MissionEditor({
  slug,
  initial,
  changeNote,
  issues,
  saveAction,
}: {
  slug: string;
  initial: EditorDoc;
  changeNote: string;
  issues: string[];
  saveAction: (fd: FormData) => Promise<void>;
}) {
  const [doc, setDoc] = useState<EditorDoc>(initial);
  const [note, setNote] = useState(changeNote);
  const edit = (fn: (d: EditorDoc) => void) =>
    setDoc((d) => {
      const n = structuredClone(d);
      fn(n);
      return n;
    });
  const step = (id: EditorStep["id"], d: EditorDoc) => d.steps.find((s) => s.id === id)!;
  const sh = doc.sheet;
  const editable = expandCells(sh.editable).cells;

  return (
    <form action={saveAction} className="space-y-8">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="doc" value={JSON.stringify(doc)} />

      {/* 1. Details */}
      <Card className="space-y-4 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">1. Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <input className={input} value={doc.title} onChange={(e) => edit((d) => void (d.title = e.target.value))} maxLength={120} />
          </Field>
          <Field label="Code" hint="Looks like EX-151. Cannot be changed here.">
            <input className={`${input} bg-surface-2`} value={doc.code} readOnly />
          </Field>
          <Field label="Level">
            <select className={input} value={doc.level} onChange={(e) => edit((d) => void (d.level = e.target.value as AuthorLevel))}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Minutes">
              <input className={input} type="number" min={1} max={240} value={doc.estimatedMinutes} onChange={(e) => edit((d) => void (d.estimatedMinutes = Number(e.target.value)))} />
            </Field>
            <Field label="Pass mark (%)">
              <input className={input} type="number" min={1} max={100} value={doc.passMarkPct} onChange={(e) => edit((d) => void (d.passMarkPct = Number(e.target.value)))} />
            </Field>
          </div>
        </div>
        <Field label="Summary" hint="One sentence shown on the mission card.">
          <textarea className={area} value={doc.summary} onChange={(e) => edit((d) => void (d.summary = e.target.value))} />
        </Field>
      </Card>

      {/* 2. Steps */}
      <Card className="space-y-6 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">2. The five steps</h2>
        <p className={small}>Every mission has the same five steps. Add paragraphs, lists, formula examples and small tables to each. The Simulation step must keep the practice sheet.</p>
        {doc.steps.map((s) => (
          <fieldset key={s.id} className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 font-semibold">{STEP_TITLES[s.id]}</legend>
            {s.blocks.map((b, i) => (
              <BlockEditor
                key={i}
                block={b}
                questions={doc.questions}
                first={i === 0}
                last={i === s.blocks.length - 1}
                onChange={(nb) => edit((d) => void (step(s.id, d).blocks[i] = nb))}
                onMove={(dir) =>
                  edit((d) => {
                    const arr = step(s.id, d).blocks;
                    const j = i + dir;
                    if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j]!, arr[i]!];
                  })
                }
                onRemove={() => edit((d) => void step(s.id, d).blocks.splice(i, 1))}
              />
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`add-${s.id}`}>
                Add to {STEP_TITLES[s.id]}
              </label>
              <select id={`add-${s.id}`} className={`${input} w-auto`} defaultValue="" onChange={(e) => {
                const t = e.target.value;
                e.target.value = "";
                if (!t) return;
                edit((d) => {
                  const arr = step(s.id, d).blocks;
                  if (t === "excel-grid") arr.push({ type: "excel-grid" });
                  else if (t === "exercise-hints") arr.push({ type: "exercise-hints" });
                  else if (t === "assessment-items") arr.push({ type: "assessment-items", itemIds: d.questions.map((q) => q.id) });
                  else arr.push(structuredClone(NEW_BLOCKS[t as keyof typeof NEW_BLOCKS]));
                });
              }}>
                <option value="">+ Add a block…</option>
                {(["paragraph", "list", "formula", "table"] as const).map((t) => (
                  <option key={t} value={t}>
                    {BLOCK_LABELS[t]}
                  </option>
                ))}
                {s.id === "simulation" ? <option value="excel-grid">{BLOCK_LABELS["excel-grid"]}</option> : null}
                {s.id === "simulation" ? <option value="exercise-hints">{BLOCK_LABELS["exercise-hints"]}</option> : null}
                {s.id === "assessment" ? <option value="assessment-items">{BLOCK_LABELS["assessment-items"]}</option> : null}
              </select>
            </div>
          </fieldset>
        ))}
      </Card>

      {/* 3. Questions */}
      <Card className="space-y-6 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">3. Assessment questions</h2>
        <p className={small}>Three or four questions. The answers stay private: learners only see them as feedback after they pass.</p>
        {doc.questions.map((q, qi) => (
          <QuestionEditor
            key={q.id}
            q={q}
            onChange={(nq) => edit((d) => void (d.questions[qi] = nq))}
            onRemove={() =>
              edit((d) => {
                const id = d.questions[qi]!.id;
                d.questions.splice(qi, 1);
                for (const s of d.steps) for (const b of s.blocks) if (b.type === "assessment-items") b.itemIds = b.itemIds.filter((x) => x !== id);
              })
            }
          />
        ))}
        {doc.questions.length < 4 ? (
          <Button
            variant="secondary"
            onClick={() =>
              edit((d) => {
                let n = d.questions.length + 1;
                while (d.questions.some((q) => q.id === `q${n}`)) n += 1;
                const id = `q${n}`;
                d.questions.push({ id, type: "numeric", prompt: "", answerHint: "", options: [], expected: "", tolerance: "0.01", correctOptionId: "", rationale: "" });
                for (const b of step("assessment", d).blocks) if (b.type === "assessment-items") b.itemIds.push(id);
              })
            }
          >
            + Add a question
          </Button>
        ) : null}
      </Card>

      {/* 4. Practice sheet */}
      <Card className="space-y-5 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">4. Practice sheet</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sheet title">
            <input className={input} value={sh.title} onChange={(e) => edit((d) => void (d.sheet.title = e.target.value))} />
          </Field>
          <Field label="Objective" hint="One sentence: what the learner will produce.">
            <input className={input} value={sh.objective} onChange={(e) => edit((d) => void (d.sheet.objective = e.target.value))} />
          </Field>
        </div>
        <Field label="Instructions" hint="Mention the cells to fill. Do not give the answers.">
          <textarea className={area} value={sh.instructions} onChange={(e) => edit((d) => void (d.sheet.instructions = e.target.value))} />
        </Field>
        <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
          <Field label="Rows (1-100)">
            <input className={input} type="number" min={1} max={100} value={sh.rows} onChange={(e) => edit((d) => void (d.sheet.rows = Number(e.target.value)))} />
          </Field>
          <Field label="Columns (1-30)">
            <input className={input} type="number" min={1} max={30} value={sh.cols} onChange={(e) => edit((d) => void (d.sheet.cols = Number(e.target.value)))} />
          </Field>
        </div>

        <div>
          <h3 className="font-semibold">Starting data</h3>
          <p className={small}>What the learner sees when the sheet opens. Type numbers, words, or formulas that start with =. Leave answer cells empty.</p>
          {sh.rows * sh.cols > 600 || sh.rows < 1 || sh.cols < 1 ? (
            <p className="mt-2 text-sm text-danger">Choose a smaller grid (at most 600 cells) to edit the starting data here.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="border-collapse text-sm">
                <caption className="sr-only">Starting data</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-10" />
                    {Array.from({ length: sh.cols }, (_, c) => (
                      <th key={c} scope="col" className="px-1 text-center text-fg-muted">
                        {colName(c + 1)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: sh.rows }, (_, r) => (
                    <tr key={r}>
                      <th scope="row" className="pr-2 text-right font-normal text-fg-muted">
                        {r + 1}
                      </th>
                      {Array.from({ length: sh.cols }, (_, c) => {
                        const ref = `${colName(c + 1)}${r + 1}`;
                        return (
                          <td key={ref} className="p-0.5">
                            <input
                              aria-label={`Starting value ${ref}`}
                              className="w-28 rounded-sm border border-border bg-surface px-2 py-1 text-sm"
                              value={sh.starter[ref] ?? ""}
                              onChange={(e) => edit((d) => void (d.sheet.starter[ref] = e.target.value))}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Field label="Cells the learner fills in" hint="Write them like F2:F6, G2. Everything else is locked.">
          <input className={input} value={sh.editable} onChange={(e) => edit((d) => void (d.sheet.editable = e.target.value))} />
        </Field>

        {editable.length > 0 ? (
          <div className="space-y-3">
            <h3 className="font-semibold">Your solution</h3>
            <p className={small}>
              Type the formula a perfect answer would have in each cell. The system calculates the expected answer itself, so you never type a computed number. The name
              of each check is what the learner sees when it fails, so do not put the answer in it.
            </p>
            {editable.map((cell) => (
              <div key={cell} className="grid items-end gap-2 sm:grid-cols-[4rem_1fr_1fr_10rem]">
                <p className="font-mono font-semibold">{cell}</p>
                <Field label="Formula">
                  <input className={`${input} font-mono`} value={sh.solution[cell] ?? ""} onChange={(e) => edit((d) => void (d.sheet.solution[cell] = e.target.value))} />
                </Field>
                <Field label="Name of the check">
                  <input className={input} value={sh.labels[cell] ?? ""} onChange={(e) => edit((d) => void (d.sheet.labels[cell] = e.target.value))} />
                </Field>
                <Field label="Must use (optional)">
                  <input className={input} placeholder="SUMIF" value={sh.requireFunctions[cell] ?? ""} onChange={(e) => edit((d) => void (d.sheet.requireFunctions[cell] = e.target.value))} />
                </Field>
              </div>
            ))}
          </div>
        ) : null}

        <Field label="Also allow these functions (optional)" hint="The functions your solution uses are allowed automatically. Add others, separated by commas.">
          <input
            className={input}
            value={sh.extraFunctions.join(", ")}
            onChange={(e) => edit((d) => void (d.sheet.extraFunctions = e.target.value.split(/[,\s]+/).map((s) => s.toUpperCase()).filter(Boolean)))}
          />
        </Field>

        <Field label="Hints" hint="One hint per line, from a gentle nudge to a stronger one. Do not give the answer.">
          <textarea className={area} value={sh.hints.join("\n")} onChange={(e) => edit((d) => void (d.sheet.hints = e.target.value.split("\n")))} />
        </Field>

        <div className="space-y-3">
          <h3 className="font-semibold">What-ifs (proof the learner used formulas)</h3>
          <p className={small}>
            Change some of the starting data and the answers must change with it. Write one change per line, like <code className="font-mono">B2=160</code>. Only cells the learner
            cannot edit can change. Add at least one.
          </p>
          {sh.scenarios.map((sc, i) => (
            <div key={sc.id} className="grid items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Name">
                <input className={input} value={sc.label} onChange={(e) => edit((d) => void (d.sheet.scenarios[i]!.label = e.target.value))} />
              </Field>
              <Field label="Changes (one per line)">
                <textarea className={`${area} min-h-16 font-mono`} value={sc.overrides} onChange={(e) => edit((d) => void (d.sheet.scenarios[i]!.overrides = e.target.value))} />
              </Field>
              <Button variant="ghost" size="sm" className="sm:mt-6" onClick={() => edit((d) => void d.sheet.scenarios.splice(i, 1))}>
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              edit((d) => {
                let n = d.sheet.scenarios.length + 1;
                while (d.sheet.scenarios.some((s) => s.id === `what-if-${n}`)) n += 1;
                d.sheet.scenarios.push({ id: `what-if-${n}`, label: "", overrides: "" });
              })
            }
          >
            + Add a what-if
          </Button>
        </div>
      </Card>

      {/* 5. Send */}
      <Card className="space-y-4 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">5. Save or send for review</h2>
        <Field label="What changed? (for the reviewer)" hint="Optional for a new mission; helpful for a change to a live one.">
          <input className={input} name="changeNote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {issues.length > 0 ? (
          <div role="status" className="rounded-md border border-border-strong bg-surface-2 p-3 text-sm">
            <p className="font-medium">Before it can go for review ({issues.length} to fix, as of your last save):</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {issues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p role="status" className="rounded-md bg-accent-subtle px-3 py-2 text-sm">
            All checks passed as of your last save. You can send it for review.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value="save" variant="secondary">
            Save draft
          </Button>
          <Button type="submit" name="intent" value="submit">
            Save and send for review
          </Button>
        </div>
      </Card>
    </form>
  );
}

function Reorder({ first, last, onMove, onRemove, label }: { first: boolean; last: boolean; onMove: (d: -1 | 1) => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="sm" disabled={first} aria-label={`Move ${label} up`} onClick={() => onMove(-1)}>
        Up
      </Button>
      <Button variant="ghost" size="sm" disabled={last} aria-label={`Move ${label} down`} onClick={() => onMove(1)}>
        Down
      </Button>
      <Button variant="ghost" size="sm" aria-label={`Remove ${label}`} onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

function BlockEditor({
  block,
  questions,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  block: Block;
  questions: EditorQuestion[];
  first: boolean;
  last: boolean;
  onChange: (b: Block) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const title = BLOCK_LABELS[block.type];
  return (
    <div className="space-y-2 rounded-md bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <Reorder first={first} last={last} onMove={onMove} onRemove={onRemove} label={title} />
      </div>
      {block.type === "paragraph" ? (
        <textarea aria-label="Paragraph text" className={area} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
      ) : block.type === "list" ? (
        <textarea aria-label="Bullet list, one item per line" className={area} value={block.items.join("\n")} onChange={(e) => onChange({ ...block, items: e.target.value.split("\n") })} />
      ) : block.type === "formula" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Formula">
            <input className={`${input} font-mono`} value={block.formula} onChange={(e) => onChange({ ...block, formula: e.target.value })} />
          </Field>
          <Field label="Explanation">
            <input className={input} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
          </Field>
        </div>
      ) : block.type === "table" ? (
        <div className="space-y-2">
          <Field label="Caption">
            <input className={input} value={block.caption} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
          </Field>
          <Field label="Column names" hint="Separated by commas.">
            <input className={input} value={block.columns.join(", ")} onChange={(e) => onChange({ ...block, columns: e.target.value.split(",").map((s) => s.trim()) })} />
          </Field>
          <Field label="Rows" hint="One row per line, values separated by | (a vertical bar), as many values as columns.">
            <textarea className={`${area} font-mono`} value={block.rows.map((r) => r.join(" | ")).join("\n")} onChange={(e) => onChange({ ...block, rows: e.target.value.split("\n").map((l) => l.split("|").map((s) => s.trim())) })} />
          </Field>
        </div>
      ) : block.type === "assessment-items" ? (
        <fieldset>
          <legend className={small}>Questions shown here</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {questions.map((q) => (
              <label key={q.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={block.itemIds.includes(q.id)}
                  onChange={(e) => onChange({ ...block, itemIds: e.target.checked ? [...block.itemIds, q.id] : block.itemIds.filter((x) => x !== q.id) })}
                />
                {q.id}: {q.prompt.slice(0, 40) || "(no text yet)"}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className={small}>{block.type === "excel-grid" ? "The interactive sheet appears here (set it up in part 4)." : "The sheet's hints appear here, collapsed (write them in part 4)."}</p>
      )}
    </div>
  );
}

function QuestionEditor({ q, onChange, onRemove }: { q: EditorQuestion; onChange: (q: EditorQuestion) => void; onRemove: () => void }) {
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 font-semibold">Question {q.id}</legend>
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Answer type">
          <select
            className={input}
            value={q.type}
            onChange={(e) =>
              onChange(
                e.target.value === "numeric"
                  ? { ...q, type: "numeric", options: [], correctOptionId: "", tolerance: q.tolerance || "0.01" }
                  : { ...q, type: "single-choice", expected: "", options: q.options.length ? q.options : [{ id: "a", label: "" }, { id: "b", label: "" }], correctOptionId: q.correctOptionId || "a" },
              )
            }
          >
            <option value="numeric">A number</option>
            <option value="single-choice">One correct choice</option>
          </select>
        </Field>
        <Field label="Question">
          <textarea className={`${area} min-h-16`} value={q.prompt} onChange={(e) => onChange({ ...q, prompt: e.target.value })} />
        </Field>
      </div>
      {q.type === "numeric" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Correct answer">
            <input className={input} inputMode="decimal" value={q.expected} onChange={(e) => onChange({ ...q, expected: e.target.value })} />
          </Field>
          <Field label="Allowed difference" hint="0.01 accepts 59.99 to 60.01.">
            <input className={input} inputMode="decimal" value={q.tolerance} onChange={(e) => onChange({ ...q, tolerance: e.target.value })} />
          </Field>
          <Field label="Hint shown with the question (optional)">
            <input className={input} value={q.answerHint} onChange={(e) => onChange({ ...q, answerHint: e.target.value })} />
          </Field>
        </div>
      ) : (
        <div className="space-y-2">
          <p className={lab}>Choices (tick the correct one)</p>
          {q.options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <input
                type="radio"
                name={`correct-${q.id}`}
                className="size-5"
                aria-label={`Choice ${o.id} is correct`}
                checked={q.correctOptionId === o.id}
                onChange={() => onChange({ ...q, correctOptionId: o.id })}
              />
              <input
                aria-label={`Choice ${o.id} text`}
                className={input}
                value={o.label}
                onChange={(e) => onChange({ ...q, options: q.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={q.options.length <= 2}
                aria-label={`Remove choice ${o.id}`}
                onClick={() => onChange({ ...q, options: q.options.filter((_, j) => j !== i), correctOptionId: q.correctOptionId === o.id ? (q.options.find((_, j) => j !== i)?.id ?? "") : q.correctOptionId })}
              >
                Remove
              </Button>
            </div>
          ))}
          {q.options.length < 6 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const used = new Set(q.options.map((o) => o.id));
                const id = "abcdef".split("").find((c) => !used.has(c)) ?? `o${q.options.length + 1}`;
                onChange({ ...q, options: [...q.options, { id, label: "" }] });
              }}
            >
              + Add a choice
            </Button>
          ) : null}
        </div>
      )}
      <Field label="Why this is the answer" hint="Shown to the learner only after they pass. At least a sentence.">
        <textarea className={`${area} min-h-16`} value={q.rationale} onChange={(e) => onChange({ ...q, rationale: e.target.value })} />
      </Field>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        Remove this question
      </Button>
    </fieldset>
  );
}
