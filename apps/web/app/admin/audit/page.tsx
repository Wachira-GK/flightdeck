import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@flightdeck/ui";
import { auditLog, FAILURE_TEXT, listAuthUsers } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "Admin: audit log" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const when = (iso: string) =>
  iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: "Africa/Nairobi" }).format(new Date(iso)) : "";

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { userId, cfg } = await requireAdmin("/admin/audit", sp.refreshed === "1");
  const action = one(sp.action).slice(0, 80);
  const beforeRaw = Number(one(sp.before));
  const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : null;
  const [r, users] = await Promise.all([auditLog(cfg, userId, action, before), listAuthUsers(cfg)]);
  const email = new Map((users ?? []).map((u) => [u.id, u.email]));
  const who = (id: string | null) => (id ? (email.get(id) ?? id) : "system");
  const olderHref = (b: number) => `/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), before: String(b) }).toString()}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav aria-label="Admin" className="text-sm">
        <Link href="/admin" className="underline">
          Users
        </Link>
      </nav>
      <header className="mt-3">
        <h1 className="text-3xl font-semibold sm:text-4xl">Audit log</h1>
        <p className="mt-2 max-w-3xl text-fg-muted">
          Every sensitive action, newest first. Nobody can edit or delete these entries, not even admins. Times are Nairobi time. Opening the first page of this log is
          recorded too.
        </p>
      </header>

      {!r.ok ? (
        <p role="alert" className="mt-8 text-danger">
          {FAILURE_TEXT[r.reason]}
        </p>
      ) : (
        <>
          <form method="get" action="/admin/audit" role="search" className="mt-6 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="action" className="block text-sm font-medium">
                Show only
              </label>
              <select id="action" name="action" defaultValue={action} className="mt-1 min-h-11 rounded-md border border-border-strong bg-surface px-3">
                <option value="">All actions</option>
                {r.value.actions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="min-h-11 rounded-md border border-border-strong px-4 font-medium">
              Filter
            </button>
            {action ? (
              <Link href="/admin/audit" className="min-h-11 py-2 text-sm underline">
                Clear filter
              </Link>
            ) : null}
          </form>

          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Audit log entries, newest first</caption>
              <thead className="border-b border-border-strong bg-surface-2">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    When
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Who
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    About
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.value.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-fg-muted">
                      No entries found.
                    </td>
                  </tr>
                ) : (
                  r.value.rows.map((e) => (
                    <tr key={e.id} className="border-b border-border align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-2">{when(e.at)}</td>
                      <td className="px-4 py-2">{who(e.actorId)}</td>
                      <td className="px-4 py-2 font-medium">{e.action}</td>
                      <td className="px-4 py-2">
                        {e.entity}
                        {e.entityId ? (
                          e.entity === "user" ? (
                            <>
                              {" "}
                              <Link href={`/admin/users/${e.entityId}`} className="underline">
                                {email.get(e.entityId) ?? e.entityId}
                              </Link>
                            </>
                          ) : (
                            ` ${e.entityId}`
                          )
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-fg-muted">{e.detail}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>

          {r.value.more && r.value.rows.length > 0 ? (
            <p className="mt-4">
              <Link href={olderHref(r.value.rows[r.value.rows.length - 1]!.id)} className="underline">
                Older entries
              </Link>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
