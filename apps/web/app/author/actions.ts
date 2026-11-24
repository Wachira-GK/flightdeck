"use server";

import { redirect } from "next/navigation";
import type { ExerciseDefinition } from "@flightdeck/excel-engine";
import { blankDoc, slugify, type AuthorLevel, type EditorDoc } from "@/lib/author/doc";
import { getContent, saveDraft, submitDraft, withdrawDraft, type ContentFailure } from "@/server/author/content";
import { buildContent, contentToDoc } from "@/server/author/convert";
import { requireContentRole } from "@/server/author/guard";

// Each action: (1) re-checks the caller's role from the database, (2) takes the actor id from the verified session
// (never from the form), (3) lets the database apply the rules again, (4) returns to the editor with ?done= or ?error=.
// Redirect targets are built from a validated slug only, so they cannot point anywhere else.

const MAX_DOC_BYTES = 300_000;
const SLUG = /^[a-z0-9-]{2,64}$/;
const CODE = /^EX-\d{3}$/;
const LEVELS: AuthorLevel[] = ["beginner", "intermediate", "advanced"];

const field = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

function failTo(path: string, reason: ContentFailure | string): never {
  redirect(`${path}?error=${encodeURIComponent(reason)}`);
}

/** The sheet of the newest PUBLISHED revision of a slug (its version rules decide whether an edit needs a new sheet version). */
async function publishedExercise(cfg: Parameters<typeof getContent>[0], actor: string, items: { slug: string; revision: number; status: string }[], slug: string): Promise<ExerciseDefinition | null> {
  const pub = items.filter((i) => i.slug === slug && i.status === "published").sort((a, b) => b.revision - a.revision)[0];
  if (!pub) return null;
  const r = await getContent(cfg, actor, slug, pub.revision);
  return r.ok ? r.value.exercise : null;
}

export async function createMissionAction(fd: FormData): Promise<void> {
  const { userId, cfg } = await requireContentRole("/author/new", "write");
  const title = field(fd, "title").trim();
  const code = field(fd, "code").trim().toUpperCase();
  const level = field(fd, "level") as AuthorLevel;
  const slug = slugify(field(fd, "slug").trim() || `excel-${title}`);
  const here = "/author/new";
  if (!title || title.length > 120) failTo(here, "title");
  if (!CODE.test(code)) failTo(here, "code");
  if (!LEVELS.includes(level)) failTo(here, "level");
  if (!SLUG.test(slug)) failTo(here, "slug");
  // "Not found" is the only answer that means the address is free (an answer of "forbidden" means someone else's draft uses it).
  const existing = await getContent(cfg, userId, slug, null);
  if (existing.ok || existing.reason === "forbidden") failTo(here, "slug_taken");
  if (!existing.ok && existing.reason !== "not_found") failTo(here, existing.reason);
  const built = buildContent(blankDoc(slug, code, title, level));
  const saved = await saveDraft(cfg, userId, built, "New mission");
  if (!saved.ok) failTo(here, saved.reason);
  redirect(`/author/${slug}?done=created`);
}

export async function saveDraftAction(fd: FormData): Promise<void> {
  const slug = field(fd, "slug");
  if (!SLUG.test(slug)) redirect("/author");
  const here = `/author/${slug}`;
  const { userId, cfg, items } = await requireContentRole(here, "write");
  const raw = field(fd, "doc");
  if (raw.length === 0 || raw.length > MAX_DOC_BYTES) failTo(here, "invalid_request");
  let doc: EditorDoc;
  try {
    doc = JSON.parse(raw) as EditorDoc;
  } catch {
    return failTo(here, "invalid_request");
  }
  if (typeof doc !== "object" || doc === null || !doc.sheet || !Array.isArray(doc.steps) || !Array.isArray(doc.questions)) failTo(here, "invalid_request");
  doc.slug = slug; // the address comes from the page, never from the form body
  const prev = await publishedExercise(cfg, userId, items, slug);
  const built = buildContent(doc, prev);
  const saved = await saveDraft(cfg, userId, built, field(fd, "changeNote"));
  if (!saved.ok) failTo(here, saved.reason);
  if (field(fd, "intent") !== "submit") redirect(`${here}?done=saved`);
  if (built.issues.length > 0) redirect(`${here}?error=checks`);
  const sent = await submitDraft(cfg, userId, slug, saved.value.revision);
  if (!sent.ok) failTo(here, sent.reason);
  redirect(`${here}?done=submitted`);
}

export async function withdrawAction(fd: FormData): Promise<void> {
  const slug = field(fd, "slug");
  const revision = Number(field(fd, "revision"));
  if (!SLUG.test(slug) || !Number.isInteger(revision) || revision < 1) redirect("/author");
  const here = `/author/${slug}`;
  const { userId, cfg } = await requireContentRole(here, "write");
  const r = await withdrawDraft(cfg, userId, slug, revision);
  if (!r.ok) failTo(here, r.reason);
  redirect(`${here}?done=withdrawn`);
}

/** Starts a new draft from the live version so it can be changed (the live version stays untouched until a reviewer publishes). */
export async function newRevisionAction(fd: FormData): Promise<void> {
  const slug = field(fd, "slug");
  if (!SLUG.test(slug)) redirect("/author");
  const here = `/author/${slug}`;
  const { userId, cfg, items } = await requireContentRole(here, "write");
  const pub = items.filter((i) => i.slug === slug && i.status === "published").sort((a, b) => b.revision - a.revision)[0];
  if (!pub) failTo(here, "not_published");
  const cur = await getContent(cfg, userId, slug, pub.revision);
  if (!cur.ok) failTo(here, cur.reason);
  const item = cur.value;
  if (item.track !== "excel") failTo(here, "invalid_request");
  const doc = contentToDoc({ slug, level: item.level, mission: item.mission, exercise: item.exercise, keys: item.keys, exerciseKey: item.exerciseKey });
  const built = buildContent(doc, item.exercise);
  const saved = await saveDraft(cfg, userId, built, "");
  if (!saved.ok) failTo(here, saved.reason);
  redirect(`${here}?done=started`);
}
