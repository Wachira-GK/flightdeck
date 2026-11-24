import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, buttonVariants, Card } from "@flightdeck/ui";
import { MissionEditor } from "@/components/author/mission-editor";
import { CONTENT_FAILURE_TEXT, editableRevision, getContent, STATUS_LABEL, type ContentFailure } from "@/server/author/content";
import { buildContent, contentToDoc } from "@/server/author/convert";
import { requireContentRole } from "@/server/author/guard";
import { newRevisionAction, saveDraftAction, withdrawAction } from "../actions";

export const metadata: Metadata = { title: "Author: edit mission" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DONE: Record<string, string> = {
  created: "Draft created. Replace every [edit] line with your own words.",
  saved: "Draft saved.",
  submitted: "Sent for review. A reviewer will publish it or send it back with a comment.",
  withdrawn: "Withdrawn. It is a draft again and you can keep editing.",
  started: "New revision started from the live version. The live version is unchanged until a reviewer publishes yours.",
};

export default async function AuthorMissionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const here = `/author/${slug}`;
  const { userId, cfg, role, access, items } = await requireContentRole(here, "any");
  const rev = editableRevision(items, slug);
  if (!rev) notFound();
  const got = await getContent(cfg, userId, slug, rev.revision);
  if (!got.ok) notFound();
  const item = got.value;
  const doc = contentToDoc({ slug, level: item.level, mission: item.mission, exercise: item.exercise, keys: item.keys, exerciseKey: item.exerciseKey });
  const pub = items.filter((i) => i.slug === slug && i.status === "published").sort((a, b) => b.revision - a.revision)[0];
  let prevExercise = null;
  if (pub && pub.revision !== item.revision) {
    const p = await getContent(cfg, userId, slug, pub.revision);
    prevExercise = p.ok ? p.value.exercise : null;
  }
  const checks = buildContent(doc, prevExercise);
  const done = DONE[one(sp.done)];
  const err = one(sp.error);
  const errText = err === "checks" ? "Your draft was saved, but it cannot be sent for review yet. Fix the items listed below." : CONTENT_FAILURE_TEXT[err as ContentFailure];
  const editable = item.status === "draft" && access.canWrite && (item.mine || role === "admin");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/author" className="underline">
          Author missions
        </Link>
      </nav>
      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">
            {item.code}: {item.title}
          </h1>
          <Badge tone={item.status === "published" ? "success" : item.status === "in_review" ? "accent" : "neutral"}>{STATUS_LABEL[item.status]}</Badge>
          <span className="text-sm text-fg-muted">Revision {item.revision}</span>
        </div>
      </header>

      <div role="status" className="mt-4">
        {done ? <p className="rounded-md bg-accent-subtle px-3 py-2 text-sm">{done}</p> : null}
      </div>
      <div role="alert">{errText ? <p className="mt-2 text-danger">{errText}</p> : null}</div>

      {item.status === "draft" && item.reviewNote ? (
        <Card className="mt-4 border-border-strong p-4">
          <p className="text-sm font-semibold">A reviewer sent this back with a comment</p>
          <p className="mt-1 whitespace-pre-wrap">{item.reviewNote}</p>
        </Card>
      ) : null}

      {item.status === "in_review" ? (
        <Card className="mt-6 space-y-3 p-4 sm:p-6">
          <p>This revision is waiting for a reviewer, so it cannot be edited. You can withdraw it to keep working.</p>
          {item.mine && access.canWrite ? (
            <form action={withdrawAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="revision" value={item.revision} />
              <Button type="submit" variant="secondary">
                Withdraw from review
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {item.status === "published" || item.status === "retired" ? (
        <Card className="mt-6 space-y-3 p-4 sm:p-6">
          <p>{item.status === "published" ? "This is the live version. To change it, start a new revision; learners keep seeing this version until a reviewer publishes yours." : "This mission is retired and not shown to learners."}</p>
          <div className="flex flex-wrap gap-3">
            {item.status === "published" ? (
              <Link href={`/missions/${slug}`} className={buttonVariants({ variant: "secondary" })}>
                View as a learner
              </Link>
            ) : null}
            {item.status === "published" && access.canWrite && item.track === "excel" ? (
              <form action={newRevisionAction}>
                <input type="hidden" name="slug" value={slug} />
                <Button type="submit">Start a new revision</Button>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}

      {editable ? (
        <div className="mt-6">
          <MissionEditor slug={slug} initial={doc} changeNote={item.changeNote ?? ""} issues={checks.issues} saveAction={saveDraftAction} />
        </div>
      ) : null}
    </div>
  );
}
