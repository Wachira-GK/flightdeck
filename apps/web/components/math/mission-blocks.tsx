import {
  getMissionDataset,
  resolvePracticeQuestion,
  type MathMission,
  type MathMissionStepId,
  type MissionBlock,
} from "@flightdeck/math";
import { MathAssessmentForm } from "./assessment-form";
import { MathTex } from "./math-tex";
import { NumericQuestion } from "./numeric-question";
import { StatsExplorer } from "./stats-explorer";

/**
 * Server Component that renders one step of a Mathematics mission from its JSON definition.
 * Mission JSON is client-safe (no answers). Answer keys (*.keys.json) must never be imported here.
 * Assessment items are graded by the server (/api/missions/[slug]/assessment); keys stay server-side.
 */
export function MathMissionStep({ mission, step }: { mission: MathMission; step: MathMissionStepId }) {
  const def = mission.steps.find((s) => s.id === step);
  if (!def) return null;
  return (
    <div className="space-y-4">
      {def.blocks.map((block, i) => (
        <Block key={i} block={block} mission={mission} />
      ))}
    </div>
  );
}

function Block({ block, mission }: { block: MissionBlock; mission: MathMission }) {
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
    case "math":
      return (
        <figure>
          <MathTex tex={block.tex} displayMode={block.displayMode ?? true} />
          <figcaption className="mt-1 text-sm text-fg-muted">{block.alt}</figcaption>
        </figure>
      );
    case "definition":
      return (
        <section className="rounded-md bg-surface-2 p-4">
          <h3 className="font-semibold text-fg">
            {block.term}
            {block.excel ? <span className="ml-2 font-mono text-sm font-normal text-fg-muted">Excel: {block.excel}</span> : null}
          </h3>
          <MathTex tex={block.tex} displayMode />
          <p className="text-fg">{block.text}</p>
        </section>
      );
    case "stats-explorer": {
      const ds = getMissionDataset(mission, block.datasetId);
      return ds ? <StatsExplorer dataset={ds} label={block.label} /> : null;
    }
    case "practice-numeric": {
      const resolved = resolvePracticeQuestion(mission, block.questionId);
      return resolved ? <NumericQuestion question={resolved.question} tolerance={resolved.tolerance} /> : null;
    }
    case "assessment-items": {
      const items = mission.assessment.items.filter((it) => block.itemIds.includes(it.id));
      return <MathAssessmentForm missionSlug={mission.slug} items={items} passMark={mission.passMark} />;
    }
  }
}
