import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card } from "@flightdeck/ui";
import { FAILURE_TEXT, listMissionAccess, type AdminFailure } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";
import { setMissionAction } from "../actions";

export const metadata: Metadata = { title: "Admin: missions" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AdminMissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { userId, cfg } = await requireAdmin("/admin/missions", sp.refreshed === "1");
  const r = await listMissionAccess(cfg, userId);
  const done = one(sp.done);
  const err = one(sp.error) as AdminFailure;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <nav aria-label="Admin" className="text-sm">
        <Link href="/admin" className="underline">
          Users
        </Link>
      </nav>
      <header className="mt-3">
        <h1 className="text-3xl font-semibold sm:text-4xl">Mission access</h1>
        <p className="mt-2 max-w-3xl text-fg-muted">
          <strong>Free</strong> missions are open to everyone, including visitors who have not signed up. Every other mission opens only for learners you unlock it
          for on their user page. Turning <strong>Available</strong> off hides a mission from everyone but admins. Changes apply at once and are recorded in the audit log.
        </p>
      </header>

      <div role="status" className="mt-4">
        {done ? <p className="rounded-md bg-accent-subtle px-3 py-2 text-sm">Saved {done}.</p> : null}
      </div>
      <div role="alert">{one(sp.error) ? <p className="mt-2 text-danger">{FAILURE_TEXT[err] ?? FAILURE_TEXT.unavailable}</p> : null}</div>

      {!r.ok ? (
        <p role="alert" className="mt-8 text-danger">
          {FAILURE_TEXT[r.reason]}
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm">
            <strong>{r.value.filter((m) => m.isFree && m.isEnabled).length}</strong> free missions open to everyone, out of {r.value.length}.
          </p>
          <Card className="mt-3 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Missions and who can open them</caption>
              <thead className="border-b border-border-strong bg-surface-2">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Mission
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Free
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Available
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Unlocked for
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Save</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.value.map((m) => {
                  const id = `m-${m.slug}`;
                  return (
                    <tr key={m.slug} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium">{m.title}</span>
                        <p className="text-fg-muted">
                          {m.course} · #{m.position}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <input form={id} type="checkbox" name="free" defaultChecked={m.isFree} aria-label={`${m.title}: free`} className="size-5" />
                      </td>
                      <td className="px-4 py-3">
                        <input form={id} type="checkbox" name="enabled" defaultChecked={m.isEnabled} aria-label={`${m.title}: available`} className="size-5" />
                      </td>
                      <td className="px-4 py-3">{m.isFree ? <Badge tone="muted">everyone</Badge> : `${m.unlocks} ${m.unlocks === 1 ? "learner" : "learners"}`}</td>
                      <td className="px-4 py-3">
                        <form id={id} action={setMissionAction}>
                          <input type="hidden" name="slug" value={m.slug} />
                          <Button type="submit" variant="secondary">
                            Save<span className="sr-only"> {m.title}</span>
                          </Button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
