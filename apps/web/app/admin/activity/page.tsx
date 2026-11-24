import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@flightdeck/ui";
import { listAuthUsers } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";
import { activityOverview } from "@/server/activity";

export const metadata: Metadata = { title: "Admin: activity" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const RANGES = [7, 30, 90] as const;

const when = (iso: string) =>
  iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(new Date(iso)) : "never";
const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export default async function AdminActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { userId, cfg } = await requireAdmin("/admin/activity", sp.refreshed === "1");
  const asked = Number(one(sp.days));
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 30;
  const [o, users] = await Promise.all([activityOverview(userId, days, cfg), listAuthUsers(cfg)]);
  const email = new Map((users ?? []).map((u) => [u.id, u.email]));
  const peak = Math.max(0, ...(o?.days.map((d) => d.activeUsers) ?? []));
  const scale = Math.max(1, peak);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <nav aria-label="Admin" className="text-sm">
        <Link href="/admin" className="underline">
          Users
        </Link>
      </nav>
      <header className="mt-3">
        <h1 className="text-3xl font-semibold sm:text-4xl">Activity</h1>
        <p className="mt-2 max-w-3xl text-fg-muted">
          How often learners come back. Counts are per Nairobi day. We record who signed in and which days they were active, nothing about what they typed or answered.
          Records older than 13 months are removed.
        </p>
        <nav aria-label="Time range" className="mt-3 flex flex-wrap gap-2 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/admin/activity?days=${r}`}
              aria-current={r === days ? "page" : undefined}
              className={`rounded-md border border-border-strong px-3 py-1 ${r === days ? "bg-accent-subtle font-semibold" : ""}`}
            >
              Last {r} days
            </Link>
          ))}
        </nav>
      </header>

      {!o ? (
        <p role="alert" className="mt-8 text-danger">
          Activity could not be read right now. Try again shortly.
        </p>
      ) : (
        <>
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <dt className="text-sm text-fg-muted">Active learners (last {days} days)</dt>
              <dd className="mt-1 text-2xl font-semibold">
                {o.activeUsers} <span className="text-base font-normal text-fg-muted">of {o.totalUsers}</span>
              </dd>
            </Card>
            <Card className="p-4">
              <dt className="text-sm text-fg-muted">Sign-ins</dt>
              <dd className="mt-1 text-2xl font-semibold">{o.signIns}</dd>
            </Card>
            <Card className="p-4">
              <dt className="text-sm text-fg-muted">Busiest day</dt>
              <dd className="mt-1 text-2xl font-semibold">{peak > 0 ? `${peak} active` : "none yet"}</dd>
            </Card>
          </dl>

          <Card className="mt-6 p-4">
            <h2 className="text-lg font-semibold">Active learners per day</h2>
            <div aria-hidden="true" className="mt-4 flex h-32 items-end gap-px">
              {o.days.map((d) => (
                <div key={d.day} title={`${dayLabel(d.day)}: ${d.activeUsers}`} className="flex-1 rounded-t bg-accent" style={{ height: `${Math.max(2, (d.activeUsers / scale) * 100)}%` }} />
              ))}
            </div>
            <p aria-hidden="true" className="mt-1 flex justify-between text-xs text-fg-muted">
              <span>{o.days[0] ? dayLabel(o.days[0].day) : ""}</span>
              <span>{o.days.length ? dayLabel(o.days[o.days.length - 1]!.day) : ""}</span>
            </p>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm underline">Show the numbers as a table</summary>
              <div className="mt-2 max-h-72 overflow-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Activity per day</caption>
                  <thead>
                    <tr className="border-b border-border-strong">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Day
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Active learners
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Sign-ins
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        Visits
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...o.days].reverse().map((d) => (
                      <tr key={d.day} className="border-b border-border last:border-0">
                        <th scope="row" className="py-1 pr-4 font-normal">
                          {dayLabel(d.day)}
                        </th>
                        <td className="py-1 pr-4">{d.activeUsers}</td>
                        <td className="py-1 pr-4">{d.signIns}</td>
                        <td className="py-1">{d.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          <Card className="mt-6 overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="px-4 py-3 text-left text-lg font-semibold">Most active learners (last {days} days)</caption>
              <thead className="border-y border-border-strong bg-surface-2">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Learner
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Days active
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Sign-ins
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.topUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-fg-muted">
                      No activity recorded in this period yet.
                    </td>
                  </tr>
                ) : (
                  o.topUsers.map((u) => (
                    <tr key={u.userId} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/admin/users/${u.userId}`} className="underline">
                          {email.get(u.userId) ?? u.userId}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{u.daysActive}</td>
                      <td className="px-4 py-3">{u.signIns}</td>
                      <td className="px-4 py-3">{when(u.lastSeen)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
