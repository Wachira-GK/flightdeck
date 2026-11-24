"use client";

import { useId, useSyncExternalStore, type ReactNode } from "react";

const CHANGED = "fd-level-choice";
const memory = new Map<string, string>();

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function readChoice(key: string): string | null {
  const mem = memory.get(key);
  if (mem) return mem;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeChoice(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered between visits; the section still works for this visit.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * One collapsible level (Beginner / Intermediate / Advanced) with a + / - button.
 * The open or closed choice is remembered in this browser only (light convenience; every level starts open, so a
 * browser with storage blocked simply shows everything).
 */
export function LevelSection({
  storageKey,
  title,
  blurb,
  count,
  doneCount,
  children,
}: {
  storageKey: string;
  title: string;
  blurb: string;
  count: number;
  /** Missions finished in this level, when known (signed-in views). */
  doneCount?: number;
  children: ReactNode;
}) {
  const panelId = useId();
  const closed = useSyncExternalStore(
    subscribe,
    () => readChoice(storageKey) === "closed",
    () => false,
  );
  const open = !closed;
  const toggle = () => writeChoice(storageKey, open ? "closed" : "open");

  return (
    <div className="mt-6 rounded-md border border-border-strong">
      <h3 className="m-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-border-strong text-lg leading-none font-semibold"
          >
            {open ? "−" : "+"}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
            <span className="text-lg font-semibold">{title}</span>
            <span className="text-sm text-fg-muted">
              {doneCount !== undefined ? `${doneCount} of ${count} done` : `${count} ${count === 1 ? "mission" : "missions"}`}
            </span>
          </span>
          <span className="sr-only">{open ? "Collapse" : "Expand"} {title} missions</span>
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="px-4 pb-4">
        <p className="mb-4 text-sm text-fg-muted">{blurb}</p>
        {children}
      </div>
    </div>
  );
}
