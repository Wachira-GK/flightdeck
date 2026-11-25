"use server";

import { redirect } from "next/navigation";
import { retireContent, reviewContent } from "@/server/author/content";
import { requireContentRole } from "@/server/author/guard";

// Each action re-checks the caller's role from the database, takes the actor from the verified session, and lets the
// database apply the rules again (nobody reviews their own work; the reviewer role is needed to review; retiring a live mission also needs admin).
const SLUG = /^[a-z0-9-]{2,64}$/;

const field = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};
const back = (slug: string, q: string): never => redirect(`/review/${slug}?${q}`);

export async function reviewAction(fd: FormData): Promise<void> {
  const slug = field(fd, "slug");
  const revision = Number(field(fd, "revision"));
  const decision = field(fd, "decision");
  if (!SLUG.test(slug) || !Number.isInteger(revision) || revision < 1 || (decision !== "publish" && decision !== "return")) redirect("/review");
  const { userId, cfg } = await requireContentRole(`/review/${slug}`, "review");
  const note = field(fd, "note").trim();
  if (decision === "return" && note.length < 5) back(slug, `rev=${revision}&error=note_needed`);
  const r = await reviewContent(cfg, userId, slug, revision, decision, note);
  if (!r.ok) back(slug, `rev=${revision}&error=${encodeURIComponent(r.reason)}`);
  redirect(`/review?done=${decision === "publish" ? "published" : "returned"}`);
}

export async function retireAction(fd: FormData): Promise<void> {
  const slug = field(fd, "slug");
  if (!SLUG.test(slug)) redirect("/review");
  const { userId, cfg } = await requireContentRole(`/review/${slug}`, "review");
  const r = await retireContent(cfg, userId, slug);
  if (!r.ok) back(slug, `error=${encodeURIComponent(r.reason)}`);
  redirect("/review?done=retired");
}
