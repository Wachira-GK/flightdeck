import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonVariants, Card } from "@flightdeck/ui";
import { requireContentRole } from "@/server/author/guard";
import { STATUS_LABEL, type ContentStatus, type ContentSummary } from "@/server/author/content";

export const metadata: Metadata = { title: "Author: missions" };
export const dynamic = "force-dynamic";

const TONE: Record<ContentStatus, "neutral" | "accent" | "success"> = { draft: "neutral", in_review: "accent", published: "success", retired: "neutral" };

export default async function AuthorHome() {
  const { access, items } = await requireContentRole("/author", "any");

  // One row per mission: its open revision if there is one (draft or waiting), else the newest.
  const bySlug = new Map<string, ContentSummary[]>();
  for (const i of items) bySlug.set(i.slug, [...(bySlug.get(i.slug) ?? []), i]);
  const rows = [...bySlug.values()]
    .map((revs) => {
      const sorted = [...revs].sort((a, b) => b.revision - a.revision);
      return sorted.find((r) => r.status === "draft" || r.status === "in_review") ?? sorted[0]!;
    })
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const returned = rows.filter((r) => r.status === "draft" && r.reviewNote);
  const mine = rows.filter((r) => r.status === "draft" && !r.reviewNote);
  const waiting = rows.filter((r) => r.status === "in_review");
  const live = rows.filter((r) => r.status === "published");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">Content workspace</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Author missions</h1>
          <p className="mt-2 max-w-2xl text-fg-muted">
            Write or improve a mission here, then send it for review. A reviewer publishes it and it goes live for learners. Learners already part-way through a mission keep the version they started.
          </p>
        </div>
        <div className="flex gap-3">
          {access.canReview ? (
            <Link href="/review" className={buttonVariants({ variant: "secondary" })}>
              Review queue
            </Link>
          ) : null}
          {access.canWrite ? (
            <Link href="/author/new" className={buttonVariants()}>
              New mission
            </Link>
          ) : null}
        </div>
      </header>

      <Group title="Sent back to you" note="A reviewer asked for changes. Open the mission to read their comment." rows={returned} />
      <Group title="Your drafts" rows={mine} />
      <Group title="Waiting for review" rows={waiting} />
      <Group title="Live missions" note={access.canWrite ? "Open one to start a new revision. The live version stays unchanged until a reviewer publishes yours." : undefined} rows={live} />
    </div>
  );
}

function Group({ title, note, rows }: { title: string; note?: string; rows: ContentSummary[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="text-xl font-semibold">{title}</h2>
      {note ? <p className="mt-1 text-sm text-fg-muted">{note}</p> : null}
      <Card className="mt-3 overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="border-b border-border-strong bg-surface-2">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Mission</th>
              <th scope="col" className="px-4 py-3 font-semibold">Level</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">Revision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/author/${r.slug}`} className="font-medium underline-offset-4 hover:underline">
                    {r.code}: {r.title}
                  </Link>
                </td>
                <td className="px-4 py-3 capitalize">{r.level}</td>
                <td className="px-4 py-3">
                  <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </td>
                <td className="px-4 py-3">{r.revision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
