import { describe, expect, it } from "vitest";
import { greetingFor, hourIn, relativeTime } from "./greeting";

describe("greetingFor", () => {
  it.each([
    [0, "Good evening"],
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [16, "Good afternoon"],
    [17, "Good evening"],
    [23, "Good evening"],
  ])("hour %i -> %s", (h, expected) => {
    expect(greetingFor(h)).toBe(expected);
  });
  it("rejects invalid hours", () => {
    expect(() => greetingFor(24)).toThrow(RangeError);
    expect(() => greetingFor(1.5)).toThrow(RangeError);
  });
});

describe("hourIn", () => {
  const d = new Date("2026-11-10T07:42:00Z");
  it("converts to the given time zone", () => {
    expect(hourIn(d, "Africa/Nairobi")).toBe(10);
    expect(hourIn(d, "UTC")).toBe(7);
  });
  it("falls back to UTC for an unknown zone", () => {
    expect(hourIn(d, "Mars/Olympus_Mons")).toBe(7);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("formats minutes, hours and days", () => {
    expect(relativeTime(new Date("2026-11-10T12:00:20Z"), now)).toBe("just now");
    expect(relativeTime(new Date("2026-11-10T11:57:00Z"), now)).toBe("3 min ago");
    expect(relativeTime(new Date("2026-11-10T09:00:00Z"), now)).toBe("3 h ago");
    expect(relativeTime(new Date("2026-11-07T12:00:00Z"), now)).toBe("3 d ago");
  });
});
