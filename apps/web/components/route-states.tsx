"use client";

import { Button } from "@flightdeck/ui";
import { useEffect, useRef } from "react";

/** Shared loading skeleton; announced politely to assistive tech. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="animate-pulse space-y-6">
        <div className="h-4 w-24 rounded-md bg-surface-2" />
        <div className="h-9 w-2/3 rounded-md bg-surface-2" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-56 rounded-lg bg-surface-2 lg:col-span-2" />
          <div className="h-56 rounded-lg bg-surface-2" />
        </div>
      </div>
    </div>
  );
}

/** Shared error panel for route error boundaries. Focuses the heading so keyboard users land on it. */
export function ErrorState({
  title,
  error,
  reset,
}: {
  title: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6" role="alert">
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {title}
      </h1>
      <p className="mt-3 text-fg-muted">
        Something went wrong while loading this page. Your progress is safe.
        {error.digest ? <> Reference: <code className="font-mono">{error.digest}</code></> : null}
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
