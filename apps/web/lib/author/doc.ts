// Client-safe model of what an author edits (ADR-015, stage 2c). The author never sees JSON: the editor screen holds an
// EditorDoc, and the SERVER converts it into the mission, exercise and answer-key documents (server/author/convert.ts).
// Nothing in this file computes answers or keys.
import type { ExcelMissionBlock, ExcelMissionStepId } from "../../components/excel/missions";

export type AuthorLevel = "beginner" | "intermediate" | "advanced";

export interface EditorQuestion {
  id: string;
  type: "numeric" | "single-choice";
  prompt: string;
  /** Numeric only: a gentle hint shown with the question (no answer in it). */
  answerHint: string;
  /** Single-choice only. */
  options: { id: string; label: string }[];
  /** Numeric only, as typed. */
  expected: string;
  /** Numeric only: how far off an answer may be and still count. */
  tolerance: string;
  /** Single-choice only: id of the correct option. */
  correctOptionId: string;
  /** Why the answer is right. Shown to the learner only after they pass. */
  rationale: string;
}

/** A "what if" used to prove the learner built formulas, not typed numbers: change some inputs, the answers must follow. */
export interface EditorScenario {
  id: string;
  label: string;
  /** One change per line: "C2=160" */
  overrides: string;
}

export interface EditorSheet {
  id: string;
  version: number;
  title: string;
  objective: string;
  instructions: string;
  rows: number;
  cols: number;
  /** Cell -> typed content ("=..." for formulas). */
  starter: Record<string, string>;
  /** "F2:F6, G2" */
  editable: string;
  /** Extra functions to allow besides the ones the solution uses. */
  extraFunctions: string[];
  hints: string[];
  /** The author's own answer for each editable cell, as formulas. The system works the expected values out from it. */
  solution: Record<string, string>;
  /** Learner-facing name of each check, e.g. "Average for the region in E2". Must not reveal the value. */
  labels: Record<string, string>;
  /** Cell -> "SUMIF, AVERAGEIF": functions that cell's formula must use. */
  requireFunctions: Record<string, string>;
  scenarios: EditorScenario[];
}

export interface EditorStep {
  id: ExcelMissionStepId;
  title: string;
  blocks: ExcelMissionBlock[];
}

export interface EditorDoc {
  slug: string;
  code: string;
  title: string;
  summary: string;
  level: AuthorLevel;
  estimatedMinutes: number;
  /** Pass mark as a percent, e.g. 80. */
  passMarkPct: number;
  steps: EditorStep[];
  questions: EditorQuestion[];
  sheet: EditorSheet;
}

export const STEP_TITLES: Record<ExcelMissionStepId, string> = {
  briefing: "Briefing",
  training: "Training",
  simulation: "Simulation",
  assessment: "Assessment",
  debrief: "Debrief",
};
export const STEP_ORDER: ExcelMissionStepId[] = ["briefing", "training", "simulation", "assessment", "debrief"];

/** Marks text the author must replace before the mission can be sent for review. */
export const PLACEHOLDER = "[edit]";

export const BLOCK_LABELS: Record<ExcelMissionBlock["type"], string> = {
  paragraph: "Paragraph",
  list: "Bullet list",
  formula: "Formula example",
  table: "Small table",
  "excel-grid": "Practice sheet (the interactive grid)",
  "exercise-hints": "Hints (collapsed)",
  "assessment-items": "Assessment questions",
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** "A1" -> {col: 1, row: 1}; null when it is not a plain A1 reference. */
function parseA1(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]{1,2})([1-9][0-9]{0,2})$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}
export function colName(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "F2:F6, G2" -> ["F2","F3","F4","F5","F6","G2"]. Unknown pieces are returned in `bad`. Capped at 400 cells. */
export function expandCells(text: string): { cells: string[]; bad: string[] } {
  const cells: string[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[,\s]+/).filter(Boolean)) {
    const [a, b] = raw.split(":");
    const from = parseA1(a ?? "");
    const to = b === undefined ? from : parseA1(b);
    if (!from || !to || to.col < from.col || to.row < from.row) {
      bad.push(raw);
      continue;
    }
    for (let r = from.row; r <= to.row; r++) for (let c = from.col; c <= to.col; c++) if (cells.length < 400) cells.push(`${colName(c)}${r}`);
  }
  return { cells: [...new Set(cells)], bad };
}

/**
 * One change per line, "C2=160" -> {C2:"160"}. The value is kept EXACTLY as typed after the first "=" (spaces included:
 * cleaning exercises depend on them, and values may contain commas). A line that is not CELL=value goes to `bad`.
 */
export function parseOverrides(text: string): { overrides: Record<string, string>; bad: string[] } {
  const overrides: Record<string, string> = {};
  const bad: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const eq = line.indexOf("=");
    const ref = eq > 0 ? line.slice(0, eq).trim().toUpperCase() : "";
    if (!parseA1(ref)) {
      bad.push(line.trim());
      continue;
    }
    overrides[ref] = line.slice(eq + 1);
  }
  return { overrides, bad };
}

/** A complete, valid starter mission (a three-month total) so a new author sees the pattern. Placeholders must be replaced. */
export function blankDoc(slug: string, code: string, title: string, level: AuthorLevel): EditorDoc {
  const ph = (t: string) => `${PLACEHOLDER} ${t}`;
  return {
    slug,
    code,
    title,
    summary: ph("One sentence about what the learner will be able to do."),
    level,
    estimatedMinutes: 10,
    passMarkPct: 80,
    steps: [
      { id: "briefing", title: STEP_TITLES.briefing, blocks: [{ type: "paragraph", text: ph("Set the scene: who needs what, and why.") }] },
      {
        id: "training",
        title: STEP_TITLES.training,
        blocks: [
          { type: "paragraph", text: ph("Teach the one idea this mission is about.") },
          { type: "formula", formula: "=SUM(B2:B4)", text: ph("Explain the example in plain words.") },
        ],
      },
      {
        id: "simulation",
        title: STEP_TITLES.simulation,
        blocks: [{ type: "paragraph", text: ph("Tell the learner what to do in the sheet.") }, { type: "excel-grid" }, { type: "exercise-hints" }],
      },
      { id: "assessment", title: STEP_TITLES.assessment, blocks: [{ type: "assessment-items", itemIds: ["q1", "q2", "q3"] }] },
      { id: "debrief", title: STEP_TITLES.debrief, blocks: [{ type: "paragraph", text: ph("Sum up what the learner practised.") }] },
    ],
    questions: [
      { id: "q1", type: "numeric", prompt: ph("Ask a question whose answer is a number."), answerHint: "", options: [], expected: "60", tolerance: "0.01", correctOptionId: "", rationale: ph("Explain why this is the answer (at least a sentence).") },
      {
        id: "q2",
        type: "single-choice",
        prompt: ph("Ask a question with one correct choice."),
        answerHint: "",
        options: [
          { id: "a", label: ph("First choice") },
          { id: "b", label: ph("Second choice") },
          { id: "c", label: ph("Third choice") },
        ],
        expected: "",
        tolerance: "",
        correctOptionId: "a",
        rationale: ph("Explain why this choice is correct (at least a sentence)."),
      },
      { id: "q3", type: "numeric", prompt: ph("Ask another question whose answer is a number."), answerHint: "", options: [], expected: "30", tolerance: "0.01", correctOptionId: "", rationale: ph("Explain why this is the answer (at least a sentence).") },
    ],
    sheet: {
      id: `${slug}-sheet`,
      version: 1,
      title: ph("Name of the practice sheet"),
      objective: ph("What the learner will produce."),
      instructions: ph("Step-by-step instructions that mention the cells to fill (without giving the answer)."),
      rows: 6,
      cols: 4,
      starter: { A1: "Month", B1: "Sales", A2: "Jan", B2: "10", A3: "Feb", B3: "20", A4: "Mar", B4: "30", A5: "Total" },
      editable: "B5",
      extraFunctions: [],
      hints: [ph("A first nudge."), ph("A stronger nudge.")],
      solution: { B5: "=SUM(B2:B4)" },
      labels: { B5: "Total of the three months" },
      requireFunctions: { B5: "SUM" },
      scenarios: [{ id: "sales-change", label: "total follows the sales figures", overrides: "B2=15\nB4=45" }],
    },
  };
}
