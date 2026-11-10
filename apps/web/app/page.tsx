import Link from "next/link";
import { Badge, buttonVariants, Card } from "@flightdeck/ui";
import { MISSION_STEPS, STEP_LABELS } from "@/lib/mission";
import { tracks } from "@/lib/mock-data";

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section aria-labelledby="hero-title" className="py-20 sm:py-28">
        <p className="text-sm font-semibold tracking-wider text-accent uppercase">Mission control for analysts</p>
        <h1 id="hero-title" className="mt-4 max-w-3xl text-4xl font-semibold sm:text-5xl">
          Learn Excel and the maths behind your numbers, one mission at a time.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-fg-muted">
          Short, hands-on missions for data, business and finance analysts. Read the briefing, practise in a
          live simulation, pass the assessment and earn your certificate.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/cockpit" className={buttonVariants({ size: "lg" })}>
            Enter the Cockpit
          </Link>
          <Link href="/missions/excel-sum-101" className={buttonVariants({ variant: "secondary", size: "lg" })}>
            Try a mission
          </Link>
        </div>
      </section>

      <section aria-labelledby="flow-title" className="border-t border-border py-16">
        <h2 id="flow-title" className="text-2xl font-semibold">
          How every mission flies
        </h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-5">
          {MISSION_STEPS.map((step, i) => (
            <li key={step} className="rounded-lg border border-border bg-surface p-4">
              <span className="font-mono text-sm text-fg-muted">0{i + 1}</span>
              <p className="mt-1 font-semibold">{STEP_LABELS[step]}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-fg-muted">Finish a track to earn its Certificate.</p>
      </section>

      <section aria-labelledby="tracks-title" className="border-t border-border py-16">
        <h2 id="tracks-title" className="text-2xl font-semibold">
          Tracks
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {tracks.map((track) => (
            <li key={track.id}>
              <Card className="h-full">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">{track.name}</h3>
                  {track.status === "locked" ? (
                    <Badge tone="muted">{track.lockedReason}</Badge>
                  ) : (
                    <Badge tone="accent">Available</Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-fg-muted">{track.description}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
