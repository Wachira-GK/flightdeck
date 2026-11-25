import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, buttonVariants, Card } from "@flightdeck/ui";
import { getLiveCatalogue } from "@/server/catalogue-live";
import { authConfig, requireUser } from "@/server/auth/session";
import { getOwnEnrolments } from "@/server/enrol";

export const metadata: Metadata = { title: "Welcome, learner" };
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{2,64}$/;

export default async function WelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.course) ? sp.course[0] : sp.course;
  const course = raw && SLUG.test(raw) ? raw : "";
  const again = sp.again === "1";
  const { accessToken } = await requireUser(`/welcome${course ? `?course=${course}` : ""}`, false);
  // Only people who really are enrolled see this page (the enrolment is read with their own token).
  const state = await getOwnEnrolments(authConfig(), accessToken);
  if (!state || state.count === 0 || (course && !state.slugs.includes(course))) redirect("/catalogue");

  const tracks = await getLiveCatalogue();
  const track = tracks.find((t) => t.courses.some((c) => c.slug === course));
  const title = track?.courses.find((c) => c.slug === course)?.title ?? "your course";
  const first = track?.missions[0];

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Card className="flex flex-col items-center gap-5 p-8 text-center">
        <Badge tone="success" className="px-4 py-1 text-sm">
          Learner
        </Badge>
        <h1 className="text-3xl font-semibold sm:text-4xl">{again ? "Welcome back, learner." : "Congratulations, you are now a learner!"}</h1>
        <p className="text-fg-muted">
          {again ? "You are already enrolled in" : "You have enrolled in"} <strong className="text-fg">{title}</strong>.{" "}
          {again ? "" : "Your Guest badge is gone for good: one enrolment is all it takes, and it stays on your Cockpit from now on."}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {first ? (
            <Link href={first.href} className={buttonVariants()}>
              Start your first mission
            </Link>
          ) : null}
          <Link href="/cockpit" className={buttonVariants({ variant: "secondary" })}>
            Go to your Cockpit
          </Link>
        </div>
      </Card>
    </div>
  );
}
