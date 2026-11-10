import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export function Card({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface p-6 shadow-sm", className)}
      {...props}
    />
  );
}

export function CardEyebrow({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      className={cn("text-xs font-semibold tracking-wider text-fg-muted uppercase", className)}
      {...props}
    />
  );
}
