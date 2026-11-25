
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card } from "@flightdeck/ui";
import { FAILURE_TEXT, listUsers } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";

export const metadata: Metadata = { title: "Admin: users" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { userId, cfg, me } = await requireAdmin("/admin", sp.refreshed === "1");
  const q = one(sp.q).slice(0, 100);
  const result = await listUsers(cfg, userId, q, Number(one(sp.page)) || 1);
  const pageHref = (p: number) => `/admin?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) }).toString()}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm text-fg-muted">
          Admin ·{" "}
          <Link href="/admin/missions" className="underline">
            Mission access
          </Link>{" "}
          ·{" "}
          <Link href="/admin/activity" className="underline">
            Activity
          </Link>{" "}
          ·{" "}
          <Link href="/admin/audit" className="underline">
            Audit log
          </Link>{" "}
          ·{" "}
          <Link href="/admin/review" className="underline">
            Review flags
          </Link>{" "}
          ·{" "}
          <Link href="/admin/exams" className="underline">
            Exams
          </Link>
        </p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Users</h1>
        <p className="mt-2 text-fg-muted">
          You are signed in as {me.displayName || "an admin"}
          {me.isMaster ? " (master admin)" : ""}. Every change and every profile you open is recorded in the audit log.
        </p>
      </header>

      <form method="get" action="/admin" role="search" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">
            Search by email
          </label>
          <input id="q" name="q" type="search" defaultValue={q} maxLength={100} className="mt-1 block min-h-11 w-72 max-w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base" />
        </div>
        <Button type="submit">Search</Button>
        {q ? (
          <Link href="/admin" className="min-h-11 py-3 text-sm underline">
            Clear
          </Link>
        ) : null}
      </form>

      {!result.ok ? (
        <p role="alert" className="mt-8 text-danger">
          {FAILURE_TEXT[result.reason]}
        </p>
      ) : (
        <Card className="mt-6 overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">
              Users, newest first. {result.value.total} found.
            </caption>
            <thead className="border-b border-border-strong bg-surface-2">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  User
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Roles
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Last sign-in
                </th>
              </tr>
            </thead>
            <tbody>
              {result.value.rows.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.id}`} className="font-medium underline">
                      {u.displayName || u.email.split("@")[0]}
                    </Link>
                    <p className="text-fg-muted">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.isMaster ? <Badge tone="accent">master</Badge> : null}
                      {u.roles.map((r) => (
                        <Badge key={r} tone={r === "learner" ? "muted" : "accent"}>
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.status === "suspended" ? <Badge tone="muted">suspended</Badge> : "active"}
                    <span className="ml-2 text-fg-muted">{u.mfa ? "2-step on" : "2-step off"}</span>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{u.lastSignInAt ? new Date(u.lastSignInAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never"}</td>
                </tr>
              ))}
              {result.value.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-fg-muted">
                    No users match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      )}

      {result.ok && result.value.pages > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-4 text-sm">
          {result.value.page > 1 ? (
            <Link href={pageHref(result.value.page - 1)} className="underline">
              Previous
            </Link>
          ) : null}
          <span className="text-fg-muted">
            Page {result.value.page} of {result.value.pages}
          </span>
          {result.value.page < result.value.pages ? (
            <Link href={pageHref(result.value.page + 1)} className="underline">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
