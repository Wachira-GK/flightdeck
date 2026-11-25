import { describe, expect, it } from "vitest";
import { cockpitBadges } from "./badges";

describe("BDG cockpit badges", () => {
  it("BDG-01 nobody enrolled is a guest, whatever the stored learner role says", () => {
    expect(cockpitBadges(["learner"], false)).toEqual(["guest"]);
    expect(cockpitBadges([], false)).toEqual(["guest"]);
  });

  it("BDG-02 enrolled means learner, and guest is gone", () => {
    expect(cockpitBadges(["learner"], true)).toEqual(["learner"]);
  });

  it("BDG-03 order is learner/guest, admin, author, reviewer, whatever order the roles arrive in", () => {
    expect(cockpitBadges(["reviewer", "admin", "author", "learner"], true)).toEqual(["learner", "admin", "author", "reviewer"]);
    expect(cockpitBadges(["reviewer", "admin"], false)).toEqual(["guest", "admin", "reviewer"]);
  });

  it("BDG-04 admin alone does not show author or reviewer", () => {
    expect(cockpitBadges(["admin", "learner"], true)).toEqual(["learner", "admin"]);
  });

  it("BDG-05 when enrolment cannot be read, fall back to learner rather than wrongly calling someone a guest", () => {
    expect(cockpitBadges(["learner"], null)).toEqual(["learner"]);
  });
});
