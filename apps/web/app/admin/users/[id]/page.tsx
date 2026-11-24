
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card } from "@flightdeck/ui";
import { EDITABLE_ROLES, FAILURE_TEXT, userDetail, type AdminFailure } from "@/server/admin/admin";
import { isUuid, requireAdmin } from "@/server/admin/guard";
import { resetMfaAction, sendResetAction, setNameAction, setRolesAction, setStatusAction } from "../../actions";

export const metadata: Metadata = { title: "Admin: user" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DONE: Record<string, string> = {
  roles: "Roles saved.",
  name: "Name saved.",
  suspended: "Account suspended. They can no longer sign in.",
  reactivated: "Account reactivated.",
  reset: "Reset link sent. They must open it within an hour.",
  mfareset: "Two-step sign-in reset. They set it up again the next time they sign in.",
};
const inputClass = "mt-1 block min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base";

export default async function AdminUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const { userId, cfg } = await requireAdmin(`/admin/users/${id}`, sp.refreshed === "1");
  const r = await userDetail(cfg, userId, id);
  if (!r.ok) {
    if (r.reason === "unknown_user") notFound();
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p role="alert" className="text-danger">
          {FAILURE_TEXT[r.reason]}
        </p>
        <Link href="/admin" className="mt-4 inline-block underline">
          Back to users
        </Link>
      </div>
    );
  }
  const { user, summary } = r.value;
  const isSelf = user.id === userId;
  // The database refuses these too; the screen just does not offer buttons that can only fail.
  const locked = user.isMaster || isSelf;
  const done = DONE[one(sp.done)];
  const errCode = one(sp.error) as AdminFailure;
  const error = one(sp.error) ? (FAILURE_TEXT[errCode] ?? FAILURE_TEXT.unavailable) : "";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/admin" className="text-sm underline">
        All users
      </Link>
      <header className="mt-3">
        <h1 className="text-3xl font-semibold">{user.displayName || user.email.split("@")[0]}</h1>
        <p className="mt-1 text-fg-muted">{user.email}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {user.isMaster ? <Badge tone="accent">master admin</Badge> : null}
          {user.roles.map((x) => (
            <Badge key={x} tone={x === "learner" ? "muted" : "accent"}>
              {x}
            </Badge>
          ))}
          <Badge tone="muted">{user.status}</Badge>
          <Badge tone={user.mfa ? "accent" : "muted"}>{user.mfa ? "2-step on" : "2-step off"}</Badge>
          {isSelf ? <span className="text-sm text-fg-muted">This is you.</span> : null}
        </div>
      </header>

      <div role="status" className="mt-4">
        {done ? <p className="rounded-md bg-accent-subtle px-3 py-2 text-sm">{done}{sp.warn ? " Supabase Auth did not confirm the sign-in block; run the action again." : ""}</p> : null}
      </div>
      <div role="alert">{error ? <p className="mt-2 text-danger">{error}</p> : null}</div>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Activity summary</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Enrolments" value={summary.enrolments} />
          <Stat label="Steps completed" value={summary.stepsCompleted} />
          <Stat label="Assessment attempts" value={summary.assessmentAttempts} />
          <Stat label="Simulator checks" value={summary.exerciseAttempts} />
        </dl>
        <p className="mt-3 text-sm text-fg-muted">Opening this page was recorded in the audit log. Answers and grades cannot be edited from here.</p>
      </Card>

      {locked ? (
        <Card className="mt-6">
          <p className="text-fg-muted">
            {user.isMaster
              ? "The master admin account cannot be edited, suspended or reset from the dashboard. Moving the master role is a deliberate database step."
              : "You cannot change your own roles, status or password here. Another admin can, or use Forgot password on the sign-in page."}
          </p>
          {user.isMaster && isSelf ? (
            <form action={setNameAction} className="mt-4 max-w-sm">
              <input type="hidden" name="target" value={user.id} />
              <NameField value={user.displayName} />
              <Button type="submit" className="mt-3">
                Save name
              </Button>
            </form>
          ) : null}
        </Card>
      ) : (
        <>
          <Card className="mt-6">
            <h2 className="text-lg font-semibold">Name</h2>
            <form action={setNameAction} className="mt-3 max-w-sm">
              <input type="hidden" name="target" value={user.id} />
              <NameField value={user.displayName} />
              <Button type="submit" className="mt-3">
                Save name
              </Button>
            </form>
          </Card>

          <Card className="mt-6">
            <h2 className="text-lg font-semibold">Roles</h2>
            <p className="mt-1 text-sm text-fg-muted">Everyone keeps the learner role. Switch the others on or off.</p>
            <form action={setRolesAction} className="mt-3">
              <input type="hidden" name="target" value={user.id} />
              <fieldset>
                <legend className="sr-only">Roles</legend>
                <div className="space-y-2">
                  {EDITABLE_ROLES.map((role) => (
                    <label key={role} className="flex min-h-11 items-center gap-3">
                      <input type="checkbox" name="role" value={role} defaultChecked={user.roles.includes(role)} className="size-5" />
                      <span className="font-medium">{role}</span>
                      <span className="text-sm text-fg-muted">{ROLE_HINT[role]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label htmlFor="roles-reason" className="mt-4 block text-sm font-medium">
                Reason (optional, kept in the audit log)
              </label>
              <input id="roles-reason" name="reason" maxLength={200} className={inputClass} />
              <Button type="submit" className="mt-3">
                Save roles
              </Button>
            </form>
          </Card>

          <Card className="mt-6">
            <h2 className="text-lg font-semibold">Access</h2>
            <form action={setStatusAction} className="mt-3 max-w-md">
              <input type="hidden" name="target" value={user.id} />
              <input type="hidden" name="status" value={user.status === "suspended" ? "active" : "suspended"} />
              <label htmlFor="status-reason" className="block text-sm font-medium">
                Reason (optional)
              </label>
              <input id="status-reason" name="reason" maxLength={200} className={inputClass} />
              <Button type="submit" variant="secondary" className="mt-3">
                {user.status === "suspended" ? "Reactivate account" : "Suspend account"}
              </Button>
              <p className="mt-2 text-sm text-fg-muted">
                Suspending blocks new sign-ins at once. A page they already have open can keep working for up to an hour.
              </p>
            </form>
          </Card>

          <Card className="mt-6">
            <h2 className="text-lg font-semibold">Password</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Admins never see or set a password. This emails {user.email} a one-time link, valid for an hour, to choose a new one.
            </p>
            <form action={sendResetAction} className="mt-3">
              <input type="hidden" name="target" value={user.id} />
              <Button type="submit" variant="secondary">
                Email a reset link
              </Button>
            </form>
          </Card>

          <Card className="mt-6">
            <h2 className="text-lg font-semibold">Two-step sign-in</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {user.mfa
                ? "Their authenticator app is on. If they lost their phone, reset it: they will set up a new app at their next sign-in (admins must, before reaching the admin area)."
                : "Not set up. Nothing to reset."}
            </p>
            {user.mfa ? (
              <form action={resetMfaAction} className="mt-3">
                <input type="hidden" name="target" value={user.id} />
                <Button type="submit" variant="secondary">
                  Reset two-step sign-in
                </Button>
              </form>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}

const ROLE_HINT: Record<string, string> = {
  author: "creates draft content",
  reviewer: "reviews and publishes content (never their own)",
  support: "helps learners, access is audited",
  admin: "manages users and roles",
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function NameField({ value }: { value: string }) {
  return (
    <>
      <label htmlFor="admin-name" className="block text-sm font-medium">
        Display name
      </label>
      <input id="admin-name" name="name" defaultValue={value} maxLength={80} required className={inputClass} />
    </>
  );
}
