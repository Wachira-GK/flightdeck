import type { ContrastLevel } from "./contrast";

/**
 * Every foreground/background combination the UI is allowed to use.
 * `level` is the WCAG 2.2 AA threshold that applies to the pair.
 * If you introduce a new combination in a component, add it here first.
 */
export type TokenPair = {
  fg: string;
  bg: string;
  level: ContrastLevel;
  usage: string;
};

const textBackgrounds = ["--fd-bg", "--fd-surface", "--fd-surface-2", "--fd-accent-subtle"] as const;
const textForegrounds = [
  ["--fd-fg", "Body and heading text"],
  ["--fd-fg-muted", "Secondary text, captions, metadata"],
  ["--fd-accent", "Links, active step label, accent text"],
  ["--fd-success", "Completed status text"],
  ["--fd-warning", "Caution status text"],
  ["--fd-danger", "Error text"],
] as const;

export const TOKEN_PAIRS: readonly TokenPair[] = [
  ...textForegrounds.flatMap(([fg, usage]) =>
    textBackgrounds.map((bg) => ({ fg, bg, level: "text" as const, usage })),
  ),
  { fg: "--fd-accent-fg", bg: "--fd-accent", level: "text", usage: "Primary button label" },
  ...textBackgrounds.map((bg) => ({
    fg: "--fd-focus",
    bg,
    level: "ui" as const,
    usage: "Focus ring against any surface",
  })),
  ...textBackgrounds.map((bg) => ({
    fg: "--fd-border-strong",
    bg,
    level: "ui" as const,
    usage: "Control borders, locked-track outline, grid lines that carry meaning",
  })),
  { fg: "--fd-accent", bg: "--fd-track", level: "ui", usage: "Progress bar fill vs track" },
  { fg: "--fd-accent", bg: "--fd-surface", level: "ui", usage: "Progress fill / step marker vs card" },
];
