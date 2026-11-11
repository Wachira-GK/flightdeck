// PURE grader for Excel mission assessments (EX-101/102/103). No file or network access and no key
// imports: the caller passes the learner-safe mission and the server-only keys. That keeps it
// unit-testable and safe to reason about. Mirrors gradeMathAssessment (MA-101).
//
// Integrity rule: explanations (the key "rationale") are revealed only when the learner passes, so a
// failed attempt cannot be used to harvest answers for the retake. Pass mark comes from the
// mission JSON (mission.passMark), never from the client.
import { gradeNumericAnswer, type AssessmentResult } from "@flightdeck/math";
import type { ExcelMission, ExcelMissionKeys } from "../components/excel/missions";

export type ExcelAssessmentResult = AssessmentResult;

const MAX_ASSESSMENT_ANSWER_LENGTH = 64;

export function gradeExcelAssessment(
  mission: ExcelMission,
  keys: ExcelMissionKeys,
  answers: Record<string, unknown>,
): ExcelAssessmentResult {
  if (keys.missionSlug !== mission.slug) throw new Error(`keys belong to ${keys.missionSlug}, not ${mission.slug}`);
  const keyById = new Map(keys.items.map((k) => [k.id, k]));

  const graded = mission.assessment.items.map((item) => {
    const key = keyById.get(item.id);
    if (!key || key.type !== item.type) throw new Error(`missing or mismatched key for item ${item.id}`);
    // Own properties only, so an id like "__proto__" or "constructor" can never read a prototype.
    const raw = Object.hasOwn(answers, item.id) ? answers[item.id] : undefined;
    const answer = typeof raw === "string" ? raw.trim().slice(0, MAX_ASSESSMENT_ANSWER_LENGTH) : "";
    if (answer === "") {
      return { result: { id: item.id, status: "unanswered" as const, feedback: "No answer given." }, rationale: undefined };
    }

    if (key.type === "single-choice") {
      const correct = answer === key.correctOptionId;
      return {
        result: { id: item.id, status: correct ? ("correct" as const) : ("incorrect" as const), feedback: correct ? "Correct." : "Not quite." },
        rationale: key.rationale,
      };
    }

    const g = gradeNumericAnswer({ expected: key.expected, tolerance: key.tolerance, answer });
    // Invalid input (e.g. "3,5") keeps its helpful parse message; it never contains the expected value.
    const feedback = g.status === "invalid" ? g.feedback : g.correct ? "Correct." : "Not quite.";
    return { result: { id: item.id, status: g.status, feedback }, rationale: key.rationale };
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
    items: graded.map(({ result, rationale }) =>
      passed && rationale ? { ...result, feedback: `${result.feedback} ${rationale}` } : result,
    ),
  };
}
