import type { WorkedStep } from "./explain";
import { gradeNumericAnswer } from "./grade";
import type { MathMission, MathMissionKeys } from "./mission";

/**
 * Server-side grading of a whole mission assessment (FD-AST01 slice, no persistence yet).
 * Integrity rule: solutions (worked steps, rationales) are revealed only when the learner passes,
 * so a failed attempt cannot be used to harvest answers for the retake.
 */

export type ItemResult = {
  id: string;
  status: "correct" | "incorrect" | "invalid" | "unanswered";
  feedback: string;
  workedSteps?: WorkedStep[];
};

export type AssessmentResult = {
  missionSlug: string;
  score: number;
  passMark: number;
  passed: boolean;
  items: ItemResult[];
};

const MAX_ASSESSMENT_ANSWER_LENGTH = 64;

export function gradeMathAssessment(
  mission: MathMission,
  keys: MathMissionKeys,
  answers: Record<string, unknown>,
): AssessmentResult {
  if (keys.missionSlug !== mission.slug) throw new Error(`keys belong to ${keys.missionSlug}, not ${mission.slug}`);
  const keyById = new Map(keys.items.map((k) => [k.id, k]));

  const graded = mission.assessment.items.map((item) => {
    const key = keyById.get(item.id);
    if (!key || key.type !== (item.type === "numeric" ? "numeric" : "single-choice")) {
      throw new Error(`missing or mismatched key for item ${item.id}`);
    }
    const raw = answers[item.id];
    const answer = typeof raw === "string" ? raw.trim().slice(0, MAX_ASSESSMENT_ANSWER_LENGTH) : "";
    if (answer === "") {
      return { result: { id: item.id, status: "unanswered" as const, feedback: "No answer given." }, solution: undefined };
    }

    if (key.type === "single-choice") {
      const correct = answer === key.correctOptionId;
      return {
        result: { id: item.id, status: correct ? ("correct" as const) : ("incorrect" as const), feedback: correct ? "Correct." : "Not quite." },
        solution: { feedback: key.rationale, workedSteps: undefined },
      };
    }

    const dataset = mission.datasets.find((d) => d.id === key.explain.datasetId);
    const g = gradeNumericAnswer({
      expected: key.expected,
      tolerance: key.tolerance,
      answer,
      explain: dataset ? { statistic: key.explain.statistic, dataset: dataset.values, decimals: key.explain.decimals } : undefined,
    });
    // Invalid input (e.g. "3,5") keeps its helpful parse message; it never contains the expected value.
    const feedback = g.status === "invalid" ? g.feedback : g.correct ? "Correct." : "Not quite.";
    return {
      result: { id: item.id, status: g.status, feedback },
      solution: { feedback: g.feedback, workedSteps: g.workedSteps },
    };
  });

  const correct = graded.filter((g) => g.result.status === "correct").length;
  const total = graded.length;
  const score = total === 0 ? 0 : Math.round((correct / total) * 10000) / 100;
  const passed = total > 0 && correct / total >= mission.passMark - 1e-9;

  return {
    missionSlug: mission.slug,
    score,
    passMark: mission.passMark,
    passed,
    items: graded.map(({ result, solution }) =>
      passed && solution ? { ...result, feedback: solution.feedback, workedSteps: solution.workedSteps } : result,
    ),
  };
}
