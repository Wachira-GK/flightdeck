import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card } from "@flightdeck/ui";
import { ExcelMissionStep } from "@/components/excel";
import { STEP_ORDER, STEP_TITLES } from "@/lib/author/doc";
import { CONTENT_FAILURE_TEXT, editableRevision, getContent, STATUS_LABEL, type ContentFailure } from "@/server/author/content";
import { buildContent, contentToDoc } from "@/server/author/convert";
import { requireContentRole } from "@/server/author/guard";
import { retireAction, reviewAction } from "../actions";

export const metadata: Metadata = { title: "Review mission" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ReviewMissionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const here = `/review/${slug}`;
  const { userId, cfg, access, items } = await requireContentRole(here, "review");
  const wanted = Number(one(sp.rev));
  const target = Number.isInteger(wanted) && wanted > 0 ? items.find((i) => i.slug === slug && i.revision === wanted) : editableRevision(items, slug);
  if (!target) notFound();
  const got = await getContent(cfg, userId, slug, target.revision);
  if (!got.ok) notFound();
  const item = got.value;
  if (item.track !== "excel" || !item.exercise) notFound(); // only Excel missions are authored here

  const doc = contentToDoc({ slug, level: item.level, mission: item.mission, exercise: item.exercise, keys: item.keys, exerciseKey: item.exerciseKey });
  const pub = items.filter((i) => i.slug === slug && i.status === "published" && i.revision !== item.revision).sort((a, b) => b.revision - a.revision)[0];
  let prevExercise = null;
  if (pub) {
    const p = await getContent(cfg, userId, slug, pub.revision);
    prevExercise = p.ok ? p.value.exercise : null;
  }
  const checks = buildContent(doc, prevExercise);
  const err = one(sp.error);
  const errText = err === "note_needed" ? "Write a comment (at least a few words) so the author knows what to change." : CONTENT_FAILURE_TEXT[err as ContentFailure];
  const content = { mission: item.mission, exercise: item.exercise };
  const expectedByCell = new Map((item.exerciseKey?.expected ?? []).map((e) => [e.cell, e.value]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/review" className="underline">
          Review queue
        </Link>
      </nav>
      <header className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">
          {item.code}: {item.title}
        </h1>
        <Badge tone={item.status === "published" ? "success" : "accent"}>{STATUS_LABEL[item.status]}</Badge>
        <span className="text-sm text-fg-muted">Revision {item.revision} · {item.level}</span>
      </header>
      {item.changeNote ? <p className="mt-2 text-fg-muted">Author&apos;s note: {item.changeNote}</p> : null}
      <div role="alert">{errText ? <p className="mt-3 text-danger">{errText}</p> : null}</div>

      {/* Decision */}
      {item.status === "in_review" ? (
        <Card className="mt-6 space-y-4 p-4 sm:p-6">
          <h2 className="text-xl font-semibold">Your decision</h2>
          {item.mine ? (
            <p>You wrote this revision, so another reviewer or admin must review it.</p>
          ) : (
            <form action={reviewAction} className="space-y-3">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="revision" value={item.revision} />
              <label className="block">
                <span className="block text-sm font-medium">Comment</span>
                <span className="block text-sm text-fg-muted">Required when you send it back. Optional when you publish.</span>
                <textarea name="note" maxLength={1000} className="mt-1 min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" />
              </label>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" name="decision" value="publish" disabled={checks.issues.length > 0}>
                  Publish to learners
                </Button>
                <Button type="submit" name="decision" value="return" variant="secondary">
                  Send back with comment
                </Button>
              </div>
              {checks.issues.length > 0 ? <p className="text-sm text-danger">Publishing is switched off because the checks below are failing.</p> : null}
            </form>
          )}
        </Card>
      ) : null}

      {item.status === "published" && access.canRetire ? (
        <Card className="mt-6 space-y-3 p-4 sm:p-6">
          <h2 className="text-xl font-semibold">Retire</h2>
          <p className="text-sm text-fg-muted">Retiring hides this mission from learners. Their saved progress is kept. Only admins can do this.</p>
          <form action={retireAction}>
            <input type="hidden" name="slug" value={slug} />
            <Button type="submit" variant="secondary">
              Retire this mission
            </Button>
          </form>
        </Card>
      ) : null}

      {/* Automatic checks */}
      <Card className="mt-6 space-y-2 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">Automatic checks</h2>
        {checks.issues.length === 0 ? (
          <p>All checks pass: the mission is complete, the author&apos;s own solution passes the grader, typing the answers does not, and no answer is spelled out in the learner-facing text.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {checks.issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* Answer key (reviewers only) */}
      <Card className="mt-6 space-y-4 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">Answer key (reviewers only)</h2>
        <div>
          <h3 className="font-semibold">Assessment</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            {item.mission.assessment.items.map((q) => {
              const k = item.keys.items.find((x) => x.id === q.id);
              const answer = !k ? "(no key)" : k.type === "numeric" ? `${k.expected} (± ${k.tolerance.value})` : (q.type === "single-choice" ? q.options.find((o) => o.id === k.correctOptionId)?.label : undefined) ?? k.correctOptionId;
              return (
                <li key={q.id}>
                  <p>{q.prompt}</p>
                  <p className="text-fg-muted">
                    Answer: <strong className="text-fg">{answer}</strong>. {k?.rationale}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <h3 className="font-semibold">Practice sheet</h3>
          <table className="mt-2 w-full text-left text-sm">
            <caption className="sr-only">Solution and expected answer per cell</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1 pr-3">Cell</th>
                <th scope="col" className="py-1 pr-3">Solution</th>
                <th scope="col" className="py-1 pr-3">Expected</th>
                <th scope="col" className="py-1">Check name</th>
              </tr>
            </thead>
            <tbody>
              {item.exercise.editableCells.map((c) => (
                <tr key={c} className="border-b border-border last:border-0">
                  <td className="py-1 pr-3 font-mono">{c}</td>
                  <td className="py-1 pr-3 font-mono">{doc.sheet.solution[c] ?? "(none)"}</td>
                  <td className="py-1 pr-3">{JSON.stringify(expectedByCell.get(c) ?? "")}</td>
                  <td className="py-1">{doc.sheet.labels[c] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-fg-muted">
            What-ifs: {doc.sheet.scenarios.map((s) => s.label).join("; ") || "none"}.
          </p>
        </div>
      </Card>

      {/* Learner preview */}
      <section className="mt-8" aria-label="Preview as a learner">
        <h2 className="text-xl font-semibold">Preview as a learner</h2>
        <p className="mt-1 text-sm text-fg-muted">
          This is what a learner reads in each step. The practice sheet opens here, but its Check button only works once the mission is published.
        </p>
        {STEP_ORDER.map((id) => (
          <Card key={id} className="mt-4 space-y-3 p-4 sm:p-6">
            <h3 className="text-lg font-semibold">{STEP_TITLES[id]}</h3>
            <ExcelMissionStep mission={content} step={id} />
          </Card>
        ))}
      </section>
    </div>
  );
}
