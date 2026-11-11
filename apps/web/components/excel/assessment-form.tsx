"use client";

import { useId, useState, type FormEvent } from "react";
import type { AssessmentResult } from "@flightdeck/math";
import { Badge, Button } from "@flightdeck/ui";
import type { ExcelAssessmentItem } from "./missions";

type Props = { missionSlug: string; items: ExcelAssessmentItem[]; passMark: number };

const STATUS_LABEL: Record<AssessmentResult["items"][number]["status"], string> = {
  correct: "Correct",
  incorrect: "Not quite",
  invalid: "Check the format",
  unanswered: "Not answered",
};

/**
 * Excel assessment graded on the SERVER (/api/missions/[slug]/assessment). The browser never sees
 * the answer keys; explanations come back only when the learner passes. Nothing is saved yet.
 */
export function ExcelAssessmentForm({ missionSlug, items, passMark }: Props) {
  const uid = useId();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/missions/${encodeURIComponent(missionSlug)}/assessment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Server error ${res.status}`);
      setResult(body as AssessmentResult);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Could not reach the grader. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const resultFor = (id: string) => result?.items.find((r) => r.id === id);

  return (
    <form onSubmit={onSubmit} aria-describedby={`${uid}-note`} className="space-y-6">
      <p id={`${uid}-note`} className="text-sm text-fg-muted">
        Answer all {items.length} questions, then submit. You pass with {Math.round(passMark * 100)}% or more. Checked by
        the server; attempts are not saved yet.
      </p>
      <ol className="list-decimal space-y-6 pl-6">
        {items.map((item) => {
          const r = resultFor(item.id);
          const fieldId = `${uid}-${item.id}`;
          return (
            <li key={item.id}>
              {item.type === "single-choice" ? (
                <fieldset>
                  <legend>{item.prompt}</legend>
                  <div className="mt-2 space-y-1">
                    {item.options.map((o) => (
                      <label key={o.id} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={fieldId}
                          value={o.id}
                          checked={answers[item.id] === o.id}
                          onChange={() => setAnswers((a) => ({ ...a, [item.id]: o.id }))}
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <div>
                  <label htmlFor={fieldId}>{item.prompt}</label>
                  {item.answerHint ? (
                    <p id={`${fieldId}-hint`} className="text-sm text-fg-muted">
                      Answer format: {item.answerHint}. Type whole numbers, no commas.
                    </p>
                  ) : null}
                  <input
                    id={fieldId}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={32}
                    aria-describedby={item.answerHint ? `${fieldId}-hint` : undefined}
                    value={answers[item.id] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [item.id]: e.target.value }))}
                    className="mt-2 w-40 rounded-md border border-border-strong bg-surface px-3 py-2 font-mono"
                  />
                </div>
              )}
              {r ? (
                <div className="mt-2 text-sm">
                  <Badge tone={r.status === "correct" ? "success" : "muted"}>{STATUS_LABEL[r.status]}</Badge>{" "}
                  <span>{r.feedback}</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Button type="submit" disabled={busy}>
        {busy ? "Checking…" : "Submit assessment"}
      </Button>
      <div role="status" aria-live="polite" className="text-fg">
        {result ? (
          result.passed ? (
            <p>
              <strong>Passed — {result.score}%.</strong> Explanations are shown under each question.
            </p>
          ) : (
            <p>
              <strong>Score {result.score}%.</strong> You need {Math.round(result.passMark * 100)}% to pass. Review the
              Training and Simulation steps and try again; explanations appear once you pass.
            </p>
          )
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
