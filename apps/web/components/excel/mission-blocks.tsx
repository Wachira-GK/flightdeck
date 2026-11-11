import { ExcelAssessmentForm } from "./assessment-form";
import type { ExcelMissionContent } from "./content";
import { ExcelGrid } from "./excel-grid";
import type { ExcelMissionBlock, ExcelMissionStepId } from "./missions";

/**
 * Server Component that renders one step of an Excel mission from its JSON definition.
 * Mission and exercise JSON are learner-safe (no answers). Keys (*.keys.json, *.key.json) must never
 * be imported here: the grid's "Check my work" posts to /api/exercises/[id]/check instead.
 * Assessment items are graded by the server (/api/missions/[slug]/assessment); keys stay server-side.
 */
export function ExcelMissionStep({ mission, step }: { mission: ExcelMissionContent; step: ExcelMissionStepId }) {
  const def = mission.mission.steps.find((s) => s.id === step);
  if (!def) return null;
  return (
    <div className="space-y-4">
      {def.blocks.map((block, i) => (
        <Block key={i} block={block} content={mission} />
      ))}
    </div>
  );
}

function Block({ block, content }: { block: ExcelMissionBlock; content: ExcelMissionContent }) {
  const { mission, exercise } = content;
  switch (block.type) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-6 text-fg-muted">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "formula":
      return (
        <figure className="rounded-md bg-surface-2 p-4">
          <code className="block font-mono text-sm break-all text-fg">{block.formula}</code>
          <figcaption className="mt-2 text-fg">{block.text}</figcaption>
        </figure>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="min-w-[16rem] border-collapse text-sm">
            <caption className="mb-2 text-left font-semibold text-fg">{block.caption}</caption>
            <thead>
              <tr className="bg-surface-2">
                {block.columns.map((c) => (
                  <th key={c} scope="col" className="border border-border-strong px-3 py-1.5 text-left font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-border-strong px-3 py-1.5 font-mono">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "excel-grid":
      return (
        <>
          <p>{exercise.instructions}</p>
          <ExcelGrid exercise={exercise} />
        </>
      );
    case "exercise-hints":
      return exercise.hints.length ? (
        <details className="rounded-md border border-border-strong p-3">
          <summary className="cursor-pointer font-semibold">Hints</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-6 text-fg-muted">
            {exercise.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
        </details>
      ) : null;
    case "assessment-items": {
      const items = mission.assessment.items.filter((it) => block.itemIds.includes(it.id));
      return <ExcelAssessmentForm missionSlug={mission.slug} items={items} passMark={mission.passMark} />;
    }
  }
}
