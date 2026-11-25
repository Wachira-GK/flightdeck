"use client";

import { useEffect, useState } from "react";
import { Progress } from "@flightdeck/ui";
import type { MissionStep } from "@/lib/mission";

type Scores = { simulation: number | null; assessment: number | null };

/**
 * Header progress for a mission. Blue bar = steps finished (moves as the learner clicks through the steps); green bar =
 * score percent, shown on the Simulation and Assessment steps (best saved score, updated at once when a check or an
 * assessment is graded; the grid and the assessment form announce it with a "fd:score" window event).
 */
export function MissionProgress({ title, step, progress, scores }: { title: string; step: MissionStep; progress: number; scores: Scores }) {
  // Latest score announced by a check on this page; falls back to the saved best from the server.
  const [live, setLive] = useState<Partial<Scores>>({});
  useEffect(() => {
    const onScore = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; score?: unknown }>).detail;
      if (!d || typeof d.score !== "number" || !Number.isFinite(d.score)) return;
      const score = Math.min(100, Math.max(0, Math.round(d.score)));
      if (d.kind === "simulation") setLive((s) => ({ ...s, simulation: score }));
      if (d.kind === "assessment") setLive((s) => ({ ...s, assessment: score }));
    };
    window.addEventListener("fd:score", onScore);
    return () => window.removeEventListener("fd:score", onScore);
  }, []);

  const shown = step === "simulation" ? (live.simulation ?? scores.simulation) : step === "assessment" ? (live.assessment ?? scores.assessment) : null;
  const showScore = step === "simulation" || step === "assessment";
  return (
    <div>
      <p className="mb-2 text-sm text-fg-muted">{progress}% complete</p>
      <Progress value={progress} label={`${title} progress`} />
      {showScore ? (
        <div data-testid="score-bar" className="mt-3">
          <p className="mb-2 text-sm text-fg-muted">
            {step === "simulation" ? "Simulation score" : "Assessment score"}:{" "}
            <span className="font-semibold text-success">{shown === null ? "not scored yet" : `${shown}%`}</span>
          </p>
          <Progress value={shown ?? 0} label={`${title} ${step} score`} tone="success" />
        </div>
      ) : null}
    </div>
  );
}
