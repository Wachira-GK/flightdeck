"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// The exam screen. The clock shown here is only a display: the database holds the real deadline, refuses saves after it,
// and cannot pass a late finish. This component never receives answer keys (only prompts, options and paid-for hints).
export interface RunnerTask {
  index: number;
  type: "numeric" | "single-choice";
  prompt: string;
  options?: { id: string; label: string }[];
  hintAvailable: boolean;
  hint?: { text?: string; dropOptions?: string[] };
}
interface Outcome {
  status: string;
  late: boolean;
  passed: boolean;
  score: number;
  correct: number;
  total: number;
  topics: { code: string; title: string }[];
  certificateNumber: string | null;
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function ExamRunner(props: { attemptId: string; tasks: RunnerTask[]; secondsLeft: number; hintsLeft: number; initialAnswers: Record<string, string>; level: string }) {
  const { attemptId } = props;
  const [answers, setAnswers] = useState<Record<string, string>>(props.initialAnswers);
  const [hints, setHints] = useState<Record<number, RunnerTask["hint"]>>(() => Object.fromEntries(props.tasks.filter((t) => t.hint).map((t) => [t.index, t.hint])));
  const [hintsLeft, setHintsLeft] = useState(props.hintsLeft);
  const [left, setLeft] = useState(props.secondsLeft);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const blurs = useRef(0);
  const pastes = useRef(0);
  const dirty = useRef(false);
  const finishing = useRef(false);
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/exams/${attemptId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }, [attemptId]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setMsg("");
    const r = await post({ action: "finish", answers: answersRef.current, blurs: blurs.current, pastes: pastes.current });
    if (r.status === 200 && r.json.ok) setOutcome(r.json as unknown as Outcome);
    else {
      finishing.current = false;
      setMsg(typeof r.json.message === "string" ? r.json.message : "Could not submit. Check your connection and try again.");
    }
    setBusy(false);
  }, [post]);

  // Display clock; at zero the attempt is submitted automatically.
  useEffect(() => {
    if (outcome) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [outcome]);
  useEffect(() => {
    if (left === 0 && !outcome) void finish();
  }, [left, outcome, finish]);

  // Autosave every 4 s while something changed.
  useEffect(() => {
    if (outcome) return;
    const t = setInterval(async () => {
      if (!dirty.current) return;
      dirty.current = false;
      const r = await post({ action: "save", answers: answersRef.current });
      if (r.status !== 200) dirty.current = true;
      else if (typeof r.json.secondsLeft === "number") setLeft(r.json.secondsLeft as number);
    }, 4000);
    return () => clearInterval(t);
  }, [outcome, post]);

  // Soft integrity signals (shown to reviewers only; they never fail an attempt by themselves).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "hidden") blurs.current += 1; };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const setAnswer = (i: number, v: string) => {
    dirty.current = true;
    setAnswers((a) => ({ ...a, [String(i)]: v }));
  };

  const buyHint = async (i: number) => {
    const r = await post({ action: "hint", task: i });
    if (r.status === 200 && r.json.ok) {
      setHints((h) => ({ ...h, [i]: r.json.hint as RunnerTask["hint"] }));
      setHintsLeft(Number(r.json.hintsLeft));
    } else setMsg(typeof r.json.message === "string" ? r.json.message : "Could not get a hint.");
  };

  if (outcome) {
    return (
      <section aria-live="polite" className="mt-6 rounded-lg border border-border-strong bg-surface p-6">
        <h2 className="text-2xl font-semibold">{outcome.passed ? "You passed" : outcome.late ? "Time ran out" : "Not passed this time"}</h2>
        <p className="mt-2 text-fg-muted">
          {outcome.late ? "The answers arrived after the time limit, so this try does not count towards a pass." : `Score: ${outcome.score}% (${outcome.correct} of ${outcome.total}).`}
        </p>
        {outcome.passed && outcome.certificateNumber ? (
          <p className="mt-4">
            <Link className="font-medium underline" href={`/verify/${outcome.certificateNumber}`}>View your certificate ({outcome.certificateNumber})</Link>
          </p>
        ) : outcome.topics.length > 0 ? (
          <div className="mt-4">
            <p className="font-medium">Topics to revisit before your next try:</p>
            <ul className="mt-2 list-disc pl-6">
              {outcome.topics.map((t) => <li key={t.code}>{t.code}: {t.title}</li>)}
            </ul>
          </div>
        ) : null}
        <p className="mt-4"><Link className="underline" href="/exams">Back to exams</Link></p>
      </section>
    );
  }

  return (
    <div className="mt-6">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border-strong bg-bg/95 py-3 backdrop-blur">
        <p className="text-lg font-semibold" role="timer" aria-label="Time left">Time left: <span className={left <= 120 ? "text-danger" : ""}>{fmt(left)}</span></p>
        <p className="text-sm text-fg-muted">Hints left: {hintsLeft}</p>
      </div>
      <div role="status" className="mt-2 min-h-6 text-sm text-danger">{msg}</div>
      <ol className="mt-2 space-y-8">
        {props.tasks.map((t) => {
          const dropped = new Set(hints[t.index]?.dropOptions ?? []);
          const value = answers[String(t.index)] ?? "";
          return (
            <li key={t.index} className="rounded-lg border border-border-strong bg-surface p-5">
              <p className="font-medium">Question {t.index + 1} of {props.tasks.length}</p>
              <p className="mt-2 whitespace-pre-wrap">{t.prompt}</p>
              {t.type === "single-choice" ? (
                <fieldset className="mt-3 space-y-2">
                  <legend className="sr-only">Choose one answer</legend>
                  {t.options?.filter((o) => !dropped.has(o.id) || value === o.id).map((o) => (
                    <label key={o.id} className="flex items-start gap-2">
                      <input type="radio" name={`q${t.index}`} checked={value === o.id} onChange={() => setAnswer(t.index, o.id)} className="mt-1" />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <label className="mt-3 block">
                  <span className="text-sm text-fg-muted">Your answer (a number)</span>
                  <input
                    inputMode="decimal" autoComplete="off" value={value} maxLength={64}
                    onChange={(e) => setAnswer(t.index, e.target.value)}
                    onPaste={() => { pastes.current += 1; }}
                    className="mt-1 block w-48 rounded-md border border-border-strong bg-bg px-3 py-2"
                  />
                </label>
              )}
              {hints[t.index]?.text ? <p className="mt-3 rounded-md bg-accent-subtle px-3 py-2 text-sm">Hint: {hints[t.index]!.text}</p> : null}
              {t.hintAvailable && !hints[t.index] ? (
                <button type="button" onClick={() => void buyHint(t.index)} disabled={hintsLeft <= 0} className="mt-3 text-sm underline disabled:opacity-50">
                  Use a hint ({hintsLeft} left)
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-8">
        <button type="button" onClick={() => void finish()} disabled={busy} className="rounded-md bg-accent px-5 py-2.5 font-medium text-accent-fg disabled:opacity-60">
          {busy ? "Submitting…" : "Submit exam"}
        </button>
        <p className="mt-2 text-sm text-fg-muted">Once you submit, this try is used. You cannot go back.</p>
      </div>
    </div>
  );
}
