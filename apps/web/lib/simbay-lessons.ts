// Which Sim Bay lesson goes with which Excel mission. A mission with a lesson gets "Practise this in Sim Bay", which opens that
// lesson straight away (Sim Bay /simbay?lesson=<id>); other missions open Sim Bay's lesson list. Lesson ids are Sim Bay's own
// (public.sim_lessons). Edit this list to change a pairing; the test checks that every mission here exists.
export const SIM_LESSON_FOR_MISSION: Readonly<Record<string, string>> = {
  "excel-sum-101": "L1-sum",
  "excel-growth-108": "L2-percent-if",
  "excel-share-107": "L2-percent-if",
  "excel-if-102": "L2-percent-if",
  "excel-nested-if-104": "L2-percent-if",
  "excel-lookup-103": "L3-vlookup",
  "excel-lookup-size-128": "L3-vlookup",
  "excel-lookup-columns-129": "L3-vlookup",
  "excel-lookup-errors-131": "L3-vlookup",
  "excel-two-step-133": "L4-index-match",
  "excel-lookup-margin-134": "L4-index-match",
  "excel-clean-lookup-142": "L4-index-match",
  "excel-sumif-120": "L5-sales-analysis",
  "excel-sumifs-124": "L5-sales-analysis",
  "excel-summary-table-126": "L5-sales-analysis",
};

export const SIM_LESSON_IDS = ["L1-sum", "L2-percent-if", "L3-vlookup", "L4-index-match", "L5-sales-analysis"] as const;

/** The /simbay address for a mission: opens its lesson when it has one, and always brings the learner back to the mission. */
export function simBayHref(missionSlug: string, back: string): string {
  const lesson = Object.hasOwn(SIM_LESSON_FOR_MISSION, missionSlug) ? SIM_LESSON_FOR_MISSION[missionSlug] : undefined;
  const q = new URLSearchParams();
  if (lesson) q.set("lesson", lesson);
  q.set("from", back);
  return `/simbay?${q.toString()}`;
}
