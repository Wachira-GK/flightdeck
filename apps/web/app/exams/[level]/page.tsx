import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@flightdeck/ui";
import { ExamRunner } from "@/components/exams/exam-runner";
import { requireUser } from "@/server/auth/session";
import { EXAM_FAILURE_TEXT, examConfig, examState, getAttempt, isExamLevel, LEVEL_LABEL, publicView, type ExamFailure } from "@/server/exams";
import { startExamAction } from "../actions";

export const metadata: Metadata = { title: "Certificate exam" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });

export default async function ExamLevelPage({ params, searchParams }: { params: Promise<{ level: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { level } = await params;
  if (!isExamLevel(level)) notFound();
  const { user } = await requireUser(`/exams/${level}`, false);
  const sp = await searchParams;
  const err = typeof sp.error === "string" ? sp.error : "";
  const cfg = examConfig();
  const st = await examState(cfg, user.id, level);

  if (!st.ok) {
    return (
      <Shell level={level}>
        <p className="mt-4 text-fg-muted">{EXAM_FAILURE_TEXT[st.reason]}</p>
      </Shell>
    );
  }

  if (st.openAttemptId) {
    const a = await getAttempt(cfg, user.id, st.openAttemptId);
    if (a.ok && a.status === "in_progress") {
      return (
        <Shell level={level}>
          <p className="mt-2 text-fg-muted">
            Attempt {a.attemptNo}. Answer every question, then submit. When the time runs out your answers are submitted for you. Do not leave this page open on two devices.
          </p>
          <ExamRunner
            attemptId={a.id}
            tasks={publicView(a.plan, a.hintLog)}
            secondsLeft={a.secondsLeft}
            hintsLeft={Math.max(0, a.maxHints - a.hintsUsed)}
            initialAnswers={Object.fromEntries(Object.entries(a.answers).filter(([, v]) => typeof v === "string")) as Record<string, string>}
            level={level}
          />
        </Shell>
      );
    }
  }

  const c = st.config;
  return (
    <Shell level={level}>
      {err ? (
        <p role="alert" className="mt-4 rounded-md bg-danger-subtle px-3 py-2 text-sm">
          {err === "name" ? "Please type the name to print on your certificate (letters only, at least 2)." : EXAM_FAILURE_TEXT[err as ExamFailure] ?? "Could not start the exam."}
        </p>
      ) : null}
      {st.certificate ? (
        <Card className="mt-6 p-5">
          <p className="font-medium">You hold the {LEVEL_LABEL[level]} certificate.</p>
          <p className="mt-2">
            <Link className="underline" href={`/verify/${st.certificate.number}`}>{st.certificate.number}</Link>
          </p>
        </Card>
      ) : (
        <Card className="mt-6 p-5">
          <ul className="list-disc space-y-1 pl-5">
            <li>{c.questions} questions, {c.minutes} minutes. The clock runs on our server and keeps running if you close the page.</li>
            <li>Pass mark {c.passPct}%. Up to {c.maxHints} hints in total.</li>
            <li>{c.maxAttempts} tries in all, with {c.cooldownHours} hours between tries. You have {st.triesLeft} left.</li>
            <li>If you do not pass you see your score and the topics to revisit, not the answers.</li>
          </ul>
          {!c.enabled ? (
            <p className="mt-4 text-fg-muted">This exam is not open right now.</p>
          ) : st.triesLeft === 0 ? (
            <p className="mt-4 text-fg-muted">You have used all your tries for this level.</p>
          ) : st.nextAllowedAt ? (
            <p className="mt-4 text-fg-muted">Your next try opens on {when(st.nextAllowedAt)} (Nairobi time).</p>
          ) : (
            <form action={startExamAction} className="mt-5 space-y-3">
              <input type="hidden" name="level" value={level} />
              <label className="block">
                <span className="text-sm text-fg-muted">Name to print on your certificate</span>
                <input name="name" required minLength={2} maxLength={80} autoComplete="name" className="mt-1 block w-full max-w-sm rounded-md border border-border-strong bg-bg px-3 py-2" />
              </label>
              <button type="submit" className="rounded-md bg-accent px-5 py-2.5 font-medium text-accent-fg">Start the exam now</button>
              <p className="text-sm text-fg-muted">The clock starts as soon as you press the button.</p>
            </form>
          )}
        </Card>
      )}
    </Shell>
  );
}

function Shell({ level, children }: { level: "beginner" | "intermediate" | "advanced"; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-sm text-fg-muted"><Link href="/exams" className="underline">Certificate exams</Link></p>
      <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{LEVEL_LABEL[level]} exam</h1>
      {children}
    </div>
  );
}
