import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card } from "@flightdeck/ui";
import { requireContentRole } from "@/server/author/guard";
import { createMissionAction } from "../actions";

export const metadata: Metadata = { title: "Author: new mission" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  title: "Give the mission a title (up to 120 characters).",
  code: "The code must look like EX-151 (EX, a dash, three digits).",
  level: "Pick a level.",
  slug: "The address can only use lowercase letters, digits and dashes.",
  slug_taken: "That address is already used by another mission. Change the title or the address.",
};

export default async function NewMissionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireContentRole("/author/new", "write");
  const sp = await searchParams;
  const err = typeof sp.error === "string" ? sp.error : "";

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/author" className="underline">
          Author missions
        </Link>
      </nav>
      <h1 className="mt-3 text-3xl font-semibold">New mission</h1>
      <p className="mt-2 text-fg-muted">
        You start from a complete example (a three-month total) and change it into your own mission. Nothing is visible to learners until a reviewer publishes it.
      </p>
      <div role="alert">{err ? <p className="mt-4 text-danger">{ERRORS[err] ?? "That could not be saved. Please try again."}</p> : null}</div>
      <Card className="mt-6 p-4 sm:p-6">
        <form action={createMissionAction} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-medium">Title</span>
            <input name="title" required maxLength={120} className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium">Code</span>
            <span className="block text-sm text-fg-muted">The next free number, like EX-151.</span>
            <input name="code" required pattern="EX-\d{3}" placeholder="EX-151" className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium">Level</span>
            <select name="level" defaultValue="beginner" className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm">
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium">Web address (optional)</span>
            <span className="block text-sm text-fg-muted">Leave empty to build it from the title. It cannot be changed later.</span>
            <input name="slug" pattern="[a-z0-9-]{2,64}" className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-sm" />
          </label>
          <Button type="submit">Create draft</Button>
        </form>
      </Card>
    </div>
  );
}
