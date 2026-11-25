/**
 * Cockpit role badges (pure). Everyone signed in starts as a GUEST; the first enrolment in any course makes them a LEARNER
 * for good (Guest then disappears). Staff badges follow in a fixed order: admin, author, reviewer, support. Admin does not
 * imply author or reviewer: each of those shows only when the person really holds the role.
 */
export type BadgeId = "guest" | "learner" | "admin" | "author" | "reviewer" | "support";

export const BADGE_LABEL: Record<BadgeId, string> = {
  guest: "Guest",
  learner: "Learner",
  admin: "Admin",
  author: "Author",
  reviewer: "Reviewer",
  support: "Support",
};

/**
 * @param roles stored roles (the stored "learner" role is ignored: Guest/Learner come from enrolment)
 * @param enrolled true = has at least one enrolment; false = none; null = could not be read (fall back to the stored role)
 */
export function cockpitBadges(roles: readonly string[], enrolled: boolean | null): BadgeId[] {
  const first: BadgeId = enrolled === null ? "learner" : enrolled ? "learner" : "guest";
  const staff = (["admin", "author", "reviewer", "support"] as const).filter((r) => roles.includes(r));
  return [first, ...staff];
}
