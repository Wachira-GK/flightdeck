"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { examConfig, examState, isExamLevel, startExam, validHolder } from "@/server/exams";

// Starting an attempt: the user is the verified session user; the database applies the rules (one open attempt, tries,
// 24 hour gap, one certificate per level) again and starts the clock.
export async function startExamAction(fd: FormData): Promise<void> {
  const level = fd.get("level");
  const name = fd.get("name");
  if (!isExamLevel(level)) redirect("/exams");
  const next = `/exams/${level}`;
  const { user } = await requireUser(next, false);
  if (typeof name !== "string" || !validHolder(name)) redirect(`${next}?error=name`);
  const cfg = examConfig();
  const st = await examState(cfg, user.id, level);
  if (!st.ok) redirect(`${next}?error=${st.reason}`);
  const r = await startExam(cfg, user.id, level, st, name as string);
  if (!r.ok) redirect(`${next}?error=${r.reason}`);
  redirect(next);
}
