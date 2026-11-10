import { cn } from "../cn";

export type ProgressProps = {
  /** 0..100 */
  value: number;
  label: string;
  className?: string;
};

/** Accessible progress bar: native semantics via role="progressbar" + aria-valuenow. */
export function Progress({ value, label, className }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped}% complete`}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-track", className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-(--fd-duration-slow) ease-(--fd-ease-standard)"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
