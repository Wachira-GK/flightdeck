import Link from "next/link";
import { buttonVariants } from "@flightdeck/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold">Off the flight plan</h1>
      <p className="mt-3 text-fg-muted">We could not find that page or mission.</p>
      <Link href="/cockpit" className={buttonVariants({ className: "mt-6" })}>
        Return to the Cockpit
      </Link>
    </div>
  );
}
