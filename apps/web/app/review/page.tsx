import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonVariants, Card } from "@flightdeck/ui";
import { STATUS_LABEL, type ContentSummary } from "@/server/author/content";
import { requireContentRole } from "@/server/author/guard";

export const metadata: Metadata = { title: "Review queue" };
export const dynamic = "force-dynamic";

const DONE: Record<string, string> = {
  published: "Published. It is live for learners now.",
  returned: "Sent back to the author with your comment.",
  retired: "Retired. Learners no longer see it.",
};

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { access, items } = await requireContentRole("/review", "review");
  const sp = await searchParams;
  const done = DONE[typeof sp.done === "string" ? sp.done : ""];
  const waiting = items.filter((i) => i.status === "in_review").sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  const live = items.filter((i) => i.status === "published").sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">Content workspace</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Review queue</h1>
          <p className="mt-2 max-w-2xl text-fg-muted">
            Open a mission to read it as a learner would, check the answer key, then publish it or send it back with a comment. You cannot review your own work.
          </p>
        </div>
        {access.canWrite ? (
          <Link href="/author" className={buttonVariants({ variant: "secondary" })}>
            Author missions
          </Link>
        ) : null}
      </header>
      <div role="status" className="mt-4">
        {done ? <p className="rounded-md bg-accent-subtle px-3 py-2 text-sm">{done}</p> : null}
      </div>

      <Section title="Waiting for review" empty="Nothing is waiting for review." rows={waiting} />
      <Section title="Live missions" empty="No live missions." rows={live} />
    </div>
  );
}

function Section({ title, rows, empty }: { title: string; rows: ContentSummary[]; empty: string }) {
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="text-xl font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-fg-muted">{empty}</p>
      ) : (
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="border-b border-border-strong bg-surface-2">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Mission</th>
                <th scope="col" className="px-4 py-3 font-semibold">Level</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Revision</th>
                <th scope="col" className="px-4 py-3 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.slug}-${r.revision}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/review/${r.slug}?rev=${r.revision}`} className="font-medium underline-offset-4 hover:underline">
                      {r.code}: {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize">{r.level}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.status === "published" ? "success" : "accent"}>{STATUS_LABEL[r.status]}</Badge>
                  </td>
                  <td className="px-4 py-3">{r.revision}</td>
                  <td className="px-4 py-3 text-fg-muted">{r.mine && r.status === "in_review" ? "You wrote this" : (r.changeNote ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
