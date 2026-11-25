import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@flightdeck/ui";
import { examAttempts, examRules, FAILURE_TEXT, listAuthUsers, type ExamRule } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";
import { revokeCertificateAction, setExamRuleAction } from "./actions";

export const metadata: Metadata = { title: "Admin: certificate exams" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(new Date(iso)) : "";

const NUM: Array<[string, string, keyof ExamRule, number, number]> = [
  ["Minutes", "minutes", "minutes", 5, 240],
  ["Hints", "maxHints", "maxHints", 0, 10],
  ["Tries", "maxAttempts", "maxAttempts", 1, 20],
  ["Gap (hours)", "cooldownHours", "cooldownHours", 0, 720],
  ["Pass %", "passPct", "passPct", 1, 100],
  ["Sheet tasks", "sheetTasks", "sheetTasks", 0, 10],
  ["Questions", "questions", "questions", 0, 30],
];

export default async function AdminExamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { userId, cfg } = await requireAdmin("/admin/exams", sp.refreshed === "1");
  const [rules, attempts, users] = await Promise.all([examRules(cfg, userId), examAttempts(cfg, userId), listAuthUsers(cfg)]);
  const email = new Map((users ?? []).map((u) => [u.id, u.email]));
  const err = one(sp.error);
  const ok = one(sp.done);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav aria-label="Admin" className="text-sm">
        <Link href="/admin" className="underline">
          Users
        </Link>
      </nav>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Certificate exams</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">
        Rules for each level, recent attempts with soft integrity flags (flags are hints for a human, they never fail anyone), and certificate revoking. Every change
        is written to the audit log.
      </p>
      {ok ? (
        <p role="status" className="mt-4 font-medium">
          Saved.
        </p>
      ) : null}
      {err ? (
        <p role="alert" className="mt-4 text-danger">
          {err in FAILURE_TEXT ? FAILURE_TEXT[err as keyof typeof FAILURE_TEXT] : "That change was not accepted. Check the numbers are inside the allowed ranges."}
        </p>
      ) : null}

      {!rules.ok ? (
        <p role="alert" className="mt-8 text-danger">
          {FAILURE_TEXT[rules.reason]}
        </p>
      ) : (
        <div className="mt-6 grid gap-4">
          {rules.value.map((r) => (
            <Card key={r.level} className="p-4">
              <form action={setExamRuleAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="level" value={r.level} />
                <h2 className="w-full text-xl font-semibold capitalize">{r.level}</h2>
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="enabled" defaultChecked={r.enabled} /> Exam open
                </label>
                {NUM.map(([label, name, key, min, max]) => (
                  <label key={name} className="text-sm font-medium">
                    {label}
                    <input
                      type="number"
                      name={name}
                      min={min}
                      max={max}
                      defaultValue={Number(r[key])}
                      required
                      className="mt-1 block min-h-11 w-24 rounded-md border border-border-strong bg-surface px-2"
                    />
                  </label>
                ))}
                <button type="submit" className="min-h-11 rounded-md border border-border-strong px-4 font-medium">
                  Save {r.level}
                </button>
              </form>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-10 text-2xl font-semibold">Recent attempts</h2>
      {!attempts.ok ? (
        <p role="alert" className="mt-3 text-danger">
          {FAILURE_TEXT[attempts.reason]}
        </p>
      ) : attempts.value.length === 0 ? (
        <p className="mt-3 text-fg-muted">No exam attempts yet.</p>
      ) : (
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Started", "Learner", "Level", "Try", "Status", "Minutes", "Hints", "Flags"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attempts.value.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{when(a.startedAt)}</td>
                  <td className="px-3 py-2">{email.get(a.userId) ?? a.userId}</td>
                  <td className="px-3 py-2 capitalize">{a.level}</td>
                  <td className="px-3 py-2">{a.attemptNo}</td>
                  <td className="px-3 py-2">{a.status}</td>
                  <td className="px-3 py-2">{a.seconds == null ? "" : Math.round(a.seconds / 60)}</td>
                  <td className="px-3 py-2">{a.hintsUsed}</td>
                  <td className="px-3 py-2">{Array.isArray(a.flags) ? a.flags.map(String).join(", ") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <h2 className="mt-10 text-2xl font-semibold">Revoke a certificate</h2>
      <form action={revokeCertificateAction} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">
          Certificate number
          <input name="number" required maxLength={40} className="mt-1 block min-h-11 rounded-md border border-border-strong bg-surface px-3" />
        </label>
        <label className="text-sm font-medium">
          Reason
          <input name="reason" required minLength={3} maxLength={300} className="mt-1 block min-h-11 w-72 rounded-md border border-border-strong bg-surface px-3" />
        </label>
        <button type="submit" className="min-h-11 rounded-md border border-border-strong px-4 font-medium">
          Revoke
        </button>
      </form>
      <p className="mt-2 text-sm text-fg-muted">A revoked certificate shows as revoked on its public verify page. This cannot be undone from here.</p>
    </div>
  );
}
