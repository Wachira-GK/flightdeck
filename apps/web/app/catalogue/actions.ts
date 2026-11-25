"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { enrolInCourse } from "@/server/enrol";
import { progressConfig } from "@/server/progress";

const SLUG = /^[a-z0-9-]{2,64}$/;

/** Enrol the signed-in person in a course, then show the congratulations page. Idempotent; the user id is the verified session's. */
export async function enrolAction(fd: FormData): Promise<void> {
  const v = fd.get("course");
  const slug = typeof v === "string" ? v : "";
  if (!SLUG.test(slug)) redirect("/catalogue");
  const { user } = await requireUser("/catalogue", false);
  const r = await enrolInCourse(progressConfig(), user.id, slug);
  if (!r.ok) redirect("/catalogue?enrol=error");
  redirect(`/welcome?course=${slug}${r.already ? "&again=1" : ""}`);
}
