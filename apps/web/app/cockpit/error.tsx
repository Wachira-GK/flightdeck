"use client";

import { ErrorState } from "@/components/route-states";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState title="The Cockpit could not load" error={error} reset={reset} />;
}
