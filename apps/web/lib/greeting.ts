/** Time-of-day greeting for the Cockpit. Hour is 0..23 in the learner's (mock) time zone. */
export function greetingFor(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`hour must be an integer 0..23, got ${hour}`);
  }
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Hour (0..23) for an IANA time zone, falling back to UTC when the zone is unknown. */
export function hourIn(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    return Number.isInteger(h) ? h % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

/** "3 min ago", "2 h ago", "4 d ago" relative to `now`. */
export function relativeTime(then: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
