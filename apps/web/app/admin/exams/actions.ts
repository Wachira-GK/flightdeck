"use server";

import { redirect } from "next/navigation";
import { revokeCertificate, setExamRule } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";

// Actor comes from the verified session; the database re-checks the admin role and validates the ranges.
const LEVELS = ["beginner", "intermediate", "advanced"] as const;
const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const int = (fd: FormData, k: string) => {
  const n = Number(text(fd, k));
  return Number.isInteger(n) ? n : -1;
};
const done = (q: Record<string, string>): never => redirect(`/admin/exams?${new URLSearchParams(q).toString()}`);

export async function setExamRuleAction(fd: FormData): Promise<void> {
  const a = await requireAdmin("/admin/exams");
  const level = text(fd, "level");
  if (!(LEVELS as readonly string[]).includes(level)) return done({ error: "invalid_request" });
  const r = await setExamRule(a.cfg, a.userId, {
    level,
    enabled: fd.get("enabled") === "on",
    minutes: int(fd, "minutes"),
    maxHints: int(fd, "maxHints"),
    maxAttempts: int(fd, "maxAttempts"),
    cooldownHours: int(fd, "cooldownHours"),
    passPct: int(fd, "passPct"),
    sheetTasks: int(fd, "sheetTasks"),
    questions: int(fd, "questions"),
  });
  return done(r.ok ? { done: `rules-${level}` } : { error: r.reason });
}

export async function revokeCertificateAction(fd: FormData): Promise<void> {
  const a = await requireAdmin("/admin/exams");
  const number = text(fd, "number").trim().slice(0, 40);
  const reason = text(fd, "reason").trim().slice(0, 300);
  if (!/^[A-Za-z0-9-]{4,40}$/.test(number) || reason.length < 3) return done({ error: "invalid_request" });
  const r = await revokeCertificate(a.cfg, a.userId, number, reason);
  return done(r.ok ? { done: "revoked" } : { error: r.reason });
}
