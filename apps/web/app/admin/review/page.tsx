import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card } from "@flightdeck/ui";
import { listAuthUsers } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";
import { minutesText, reviewFlags } from "@/server/activity";

export const metadata: Metadata = { title: "Admin: review flags" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const RANGES = [30, 90, 365] as const;
const when = (iso: string) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Nairobi" }).format(new Date(iso)) : "");

export default async function AdminReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { userId, cfg } = await requireAdmin("/admin/review", sp.refreshed === "1");
  const asked = Number(one(sp.days));
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 90;
  const [r, users] = await Promise.all([reviewFlags(userId, days, 180, cfg), listAuthUsers(cfg)]);
  const email = new Map((users ?? []).map((u) => [u.id, u.email]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <nav aria-label="Admin" className="text-sm">
        <Link href="/admin" className="underline">
          Users
        </Link>
      </nav>
      <header className="mt-3">
        <h1 className="text-3xl font-semibold sm:text-4xl">Fast passes to review</h1>
        <p className="mt-2 max-w-3xl text-fg-muted">
          Passed assessments where we recorded under 3 minutes of active time on that mission. This is a prompt to take a look, never proof of anything: a learner may have
          used FlightDeck on a device that blocks the timer, or passed before time tracking began
          {r?.trackingSince ? ` (tracking began ${when(r.trackingSince)})` : ""}. Nothing here changes a grade or blocks a learner.
        </p>
        <nav aria-label="Time range" className="mt-3 flex flex-wrap gap-2 text-sm">
          {RANGES.map((d) => (
            <Link key={d} href={`/admin/review?days=${d}`} aria-current={d === days ? "page" : undefined} className={`rounded-md border border-border-strong px-3 py-1 ${d === days ? "bg-accent-subtle font-semibold" : ""}`}>
              Last {d} days
            </Link>
          ))}
        </nav>
      </header>

      {!r ? (
        <p role="alert" className="mt-8 text-danger">
          The review list could not be read right now. Try again shortly.
        </p>
      ) : (
        <Card className="mt-6 overflow-x-auto p-0">
          <table className="w-full min-w-[620px] text-left text-sm">
            <caption className="sr-only">Passed assessments with little recorded active time</caption>
            <thead className="border-b border-border-strong bg-surface-2">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Learner
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Mission
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Score
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Passed on
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Active time
                </th>
              </tr>
            </thead>
            <tbody>
              {r.flags.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-fg-muted">
                    Nothing to review in this period.
                  </td>
                </tr>
              ) : (
                r.flags.map((f) => (
                  <tr key={`${f.userId}-${f.slug}-${f.gradedAt}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/admin/users/${f.userId}`} className="underline">
                        {email.get(f.userId) ?? f.userId}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{f.slug}</td>
                    <td className="px-4 py-3">{f.score}%</td>
                    <td className="px-4 py-3">{when(f.gradedAt)}</td>
                    <td className="px-4 py-3">
                      {f.reason === "no_time" ? <Badge tone="muted">none recorded</Badge> : minutesText(f.seconds)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
