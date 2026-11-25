import Link from "next/link";
import { Badge, badgeVariants, cn } from "@flightdeck/ui";
import { BADGE_LABEL, type BadgeId } from "@/lib/badges";

type Tone = "neutral" | "success" | "accent";
const TONE: Record<BadgeId, Tone> = { guest: "neutral", learner: "success", admin: "accent", author: "accent", reviewer: "accent", support: "accent" };

/** Role badge, in the same look everywhere (Cockpit header, Actions box, welcome page). */
export function RoleBadge({ id }: { id: BadgeId }) {
  return <Badge tone={TONE[id]}>{BADGE_LABEL[id]}</Badge>;
}

const GROUPS: Partial<Record<BadgeId, { href: string; label: string }[]>> = {
  learner: [
    { href: "/catalogue", label: "Catalogue" },
    { href: "/exams", label: "Certificate exams" },
    { href: "/account/security", label: "Account security" },
  ],
  admin: [
    { href: "/admin", label: "Users" },
    { href: "/admin/missions", label: "Mission access" },
    { href: "/admin/exams", label: "Exam rules" },
    { href: "/admin/activity", label: "Activity" },
    { href: "/admin/review", label: "Fast-pass flags" },
    { href: "/admin/audit", label: "Audit log" },
  ],
  author: [
    { href: "/author", label: "My missions" },
    { href: "/author/new", label: "New mission" },
  ],
  reviewer: [{ href: "/review", label: "Review queue" }],
};

/** One collapsible box, grouped by role badge: everything this person can do from the Cockpit, as pill buttons. */
export function CockpitActions({ badges }: { badges: BadgeId[] }) {
  // Guests get the learner group too (catalogue, exams, security): the two are the same set of links.
  const groups = badges.map((b) => ({ id: b, links: GROUPS[b === "guest" ? "learner" : b] ?? [] })).filter((g) => g.links.length > 0);
  return (
    <details open className="group mt-5 rounded-xl border border-border bg-surface" data-testid="cockpit-actions">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
        <span>Actions</span>
        <span aria-hidden="true" className="text-fg-muted transition-transform group-open:rotate-180">
          &#9662;
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
        {groups.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0">
              <RoleBadge id={g.id} />
            </span>
            {g.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  badgeVariants({ tone: TONE[g.id] }),
                  "px-3.5 py-1.5 text-sm transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
