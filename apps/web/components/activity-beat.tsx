"use client";

import { useEffect } from "react";

const BEAT_MS = 15_000;
const IDLE_MS = 60_000;

/**
 * Tells the server "this learner is active on this mission" every 15 seconds, but ONLY while the tab is visible and the person
 * has moved the mouse, touched, scrolled or pressed a key in the last minute. It sends the mission name and a number, nothing
 * they typed. It renders nothing, and if the request fails nothing happens (ADR-012).
 */
export function ActiveTimeBeat({ slug }: { slug: string }) {
  useEffect(() => {
    let lastInput = Date.now();
    const mark = () => {
      lastInput = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastInput > IDLE_MS) return;
      void fetch("/api/activity/beat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, seconds: BEAT_MS / 1000 }),
        keepalive: true,
      }).catch(() => undefined);
    }, BEAT_MS);
    return () => {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, mark);
    };
  }, [slug]);
  return null;
}
