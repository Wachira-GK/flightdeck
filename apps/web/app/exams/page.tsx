import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonVariants, Card } from "@flightdeck/ui";
import { requireUser } from "@/server/auth/session";
import { EXAM_LEVELS, examConfig, examState, LEVEL_LABEL, type ExamState } from "@/server/exams";

export const metadata: Metadata = { title: "Certificate exams" };
export const dynamic = "force-dynamic";

export default async function ExamsHome() {
  const { user } = await requireUser("/exams", false);
  const cfg = examConfig();
  const states = await Promise.all(EXAM_LEVELS.map(async (l) => [l, await examState(cfg, user.id, l)] as const));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <p className="text-sm text-fg-muted">Certificates</p>
      <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Certificate exams</h1>
      <p className="mt-2 max-w-2xl text-fg-muted">
        One timed exam for each level. Questions are drawn from that level&apos;s missions and change from try to try. Practice in the missions never counts here, and the exam is the only way to earn a certificate.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {states.map(([level, st]) => (
          <Card key={level} className="p-5">
            <h2 className="text-xl font-semibold">{LEVEL_LABEL[level]}</h2>
            {!st.ok ? (
              <p className="mt-2 text-sm text-fg-muted">Not available right now.</p>
            ) : (
              <Summary s={st} />
            )}
            <Link href={`/exams/${level}`} className={`${buttonVariants({ variant: "secondary" })} mt-4`}>
              {st.ok && st.certificate ? "View" : st.ok && st.openAttemptId ? "Continue" : "Open"}
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Summary({ s }: { s: ExamState }) {
  if (s.certificate) return <Badge tone="success">Certified</Badge>;
  return (
    <p className="mt-2 text-sm text-fg-muted">
      {s.config.minutes} minutes, {s.config.questions} questions, pass at {s.config.passPct}%. Tries left: {s.triesLeft} of {s.config.maxAttempts}.
    </p>
  );
}
