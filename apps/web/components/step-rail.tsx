import Link from "next/link";
import { cn } from "@flightdeck/ui";
import { MISSION_STEPS, STEP_LABELS, stepStatus, type MissionStep } from "@/lib/mission";

/**
 * Mission step rail. Plain links (Tab / Shift+Tab / Enter) so it works without JavaScript;
 * the step being viewed carries aria-current="step".
 */
export function StepRail({
  slug,
  current,
  completed,
}: {
  slug: string;
  current: MissionStep;
  completed: readonly MissionStep[];
}) {
  return (
    <nav aria-label="Mission steps">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {MISSION_STEPS.map((step, i) => {
          const status = stepStatus(step, current, completed);
          return (
            <li key={step} className="shrink-0">
              <Link
                href={`/missions/${slug}?step=${step}`}
                aria-current={status === "current" ? "step" : undefined}
                scroll={false}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors duration-(--fd-duration-fast)",
                  status === "current"
                    ? "border-accent bg-accent-subtle font-semibold text-accent"
                    : "border-transparent text-fg hover:bg-surface-2",
                )}
              >
                <StepMarker index={i + 1} status={status} />
                <span>{STEP_LABELS[step]}</span>
                {status === "complete" ? <span className="sr-only">(completed)</span> : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepMarker({ index, status }: { index: number; status: ReturnType<typeof stepStatus> }) {
  const base = "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold";
  if (status === "complete") {
    return (
      <span aria-hidden="true" className={cn(base, "border-success text-success")}>
        <svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        base,
        status === "current" ? "border-accent bg-accent text-accent-fg" : "border-border-strong text-fg-muted",
      )}
    >
      {index}
    </span>
  );
}
