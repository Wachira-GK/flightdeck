"use client";

import { useId, useState, type FormEvent } from "react";
import {
  computeStatistic,
  gradeNumericAnswer,
  type NumericGradeResult,
  type NumericPracticeQuestion,
  type Tolerance,
} from "@flightdeck/math";
import { Badge, Button, cn } from "@flightdeck/ui";
import { MathTex } from "./math-tex";

export type NumericQuestionProps = {
  /** Resolve from mission JSON with resolvePracticeQuestion(mission, id) from @flightdeck/math. */
  question: NumericPracticeQuestion;
  tolerance: Tolerance;
  className?: string;
};

/**
 * PRACTICE CHECK, graded in the browser for instant feedback. It is not an assessment attempt:
 * nothing is saved, and the expected value is derived from the public dataset (no answer key is sent
 * to the client). Graded attempts will be checked server-side against *.keys.json once the
 * database is back.
 */
export function NumericQuestion({ question, tolerance, className }: NumericQuestionProps) {
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<NumericGradeResult | null>(null);

  const uid = useId();
  const ids = {
    heading: `${uid}-heading`,
    input: `${uid}-input`,
    hint: `${uid}-hint`,
    error: `${uid}-error`,
    steps: `${uid}-steps`,
  };

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const expected = computeStatistic(question.statistic, question.dataset);
    setResult(
      gradeNumericAnswer({
        expected,
        tolerance,
        answer,
        explain: {
          statistic: question.statistic,
          dataset: question.dataset,
          decimals: Math.max(2, question.decimals ?? 2),
          unit: question.unit,
        },
      }),
    );
  }

  const invalid = result?.status === "invalid";
  const describedBy = [ids.hint, invalid ? ids.error : null].filter(Boolean).join(" ");

  return (
    <section aria-labelledby={ids.heading} className={cn("rounded-lg border border-border-strong bg-surface p-4 sm:p-6", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="accent">Practice check</Badge>
        <p className="text-sm text-fg-muted">Not graded or saved. Your graded attempt happens in the Assessment.</p>
      </div>
      <h3 id={ids.heading} className="mt-3 text-lg font-semibold text-fg">
        {question.prompt}
      </h3>

      <form onSubmit={onSubmit} noValidate className="mt-4">
        <label htmlFor={ids.input} className="block font-medium text-fg">
          Your answer{question.unit ? ` (${question.unit})` : ""}
        </label>
        <div className="mt-2 flex flex-wrap items-start gap-3">
          <input
            id={ids.input}
            name="answer"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={cn(
              "h-11 w-40 rounded-md border bg-surface px-3 font-mono text-fg",
              invalid ? "border-danger" : "border-border-strong",
            )}
          />
          <Button type="submit">Check answer</Button>
        </div>
        <p id={ids.hint} className="mt-2 text-sm text-fg-muted">
          Use a dot for decimals, for example 12.5.
          {question.decimals !== undefined ? ` Round to ${question.decimals} decimal place${question.decimals === 1 ? "" : "s"}.` : ""}
        </p>
        {invalid ? (
          <p id={ids.error} className="mt-2 text-sm font-medium text-danger">
            {result?.feedback}
          </p>
        ) : null}
      </form>

      {/* Feedback is announced politely; the (longer) worked steps follow outside the live region. */}
      <div aria-live="polite" aria-atomic="true">
        {result && !invalid ? (
          <p className={cn("mt-4 font-medium", result.correct ? "text-success" : "text-fg")}>
            <span aria-hidden="true">{result.correct ? "✓ " : "↻ "}</span>
            {result.feedback}
          </p>
        ) : null}
      </div>

      {result && result.workedSteps.length > 0 ? (
        <div className="mt-4 rounded-md bg-surface-2 p-4">
          <h4 id={ids.steps} className="font-semibold text-fg">
            Worked steps
          </h4>
          <ol aria-labelledby={ids.steps} className="mt-2 list-decimal space-y-3 pl-6 text-fg">
            {result.workedSteps.map((step, i) => (
              <li key={i}>
                <p>{step.text}</p>
                {step.tex ? (
                  <span aria-hidden="true" className="mt-1 block overflow-x-auto text-sm">
                    <MathTex tex={step.tex} />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
