import type { MathMission } from "@flightdeck/math";
import descriptiveStats101 from "../../../../content/math/missions/descriptive-stats-101.json";

/**
 * Client-safe Mathematics mission definitions (no answers). Answer keys live in
 * content/math/missions/*.keys.json and must only ever be read by server-side grading code.
 */
const MATH_MISSIONS: Record<string, MathMission> = {
  "descriptive-stats-101": descriptiveStats101 as unknown as MathMission,
};

export function getMathMission(slug: string): MathMission | undefined {
  return Object.hasOwn(MATH_MISSIONS, slug) ? MATH_MISSIONS[slug] : undefined;
}
