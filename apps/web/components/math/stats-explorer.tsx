"use client";

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  axisLabels,
  clampToStep,
  describeChart,
  describeStats,
  formatNumber,
  linearScale,
  niceTicks,
  replaceAt,
  statFormulas,
  summarize,
  validateExplorerDataset,
  type StatsExplorerDataset,
} from "@flightdeck/math";
import { cn } from "@flightdeck/ui";
import { MathTex } from "./math-tex";

export type StatsExplorerProps = {
  dataset: StatsExplorerDataset;
  /** Accessible name / visible heading. Defaults to dataset.title. */
  label?: string;
  className?: string;
};

// SVG geometry in viewBox units; the chart scales to its container width.
const W = 440;
const H = 270;
const M = { top: 12, right: 8, bottom: 46, left: 40 };
/** Font size in viewBox units: about 11px when the chart is squeezed to a 340px phone column. */
const FONT = 14;
/** Delay before the live region speaks, so holding an arrow key does not flood the screen reader. */
const ANNOUNCE_DELAY_MS = 450;

const motion =
  "transition-all duration-(--fd-duration-base) ease-(--fd-ease-standard) motion-reduce:transition-none";

/**
 * Interactive descriptive-statistics visual: a bar chart with mean and median lines and ONE control
 * (a slider that moves one data point). Mean, median, range and standard deviation update live with
 * KaTeX formulas. Accessible alternatives: SVG role="img" with a text summary, a polite live region,
 * and a data table. Colours come only from design tokens (var(--fd-*)).
 */
export function StatsExplorer({ dataset, label, className }: StatsExplorerProps) {
  const ds = useMemo(() => validateExplorerDataset(dataset), [dataset]);
  const { index, min: lo, max: hi, step } = ds.adjustable;
  const decimals = ds.decimals ?? 1;
  const spread = ds.spread ?? "sample";
  const adjustableLabel = ds.adjustable.label ?? ds.labels[index] ?? `Value ${index + 1}`;
  const original = ds.values[index] as number;

  const [point, setPoint] = useState(original);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const values = useMemo(() => replaceAt(ds.values, index, point), [ds.values, index, point]);
  const stats = useMemo(() => summarize(values, spread), [values, spread]);
  const formulas = useMemo(() => statFormulas(values, spread, decimals), [values, spread, decimals]);
  const f = (v: number) => formatNumber(v, decimals);

  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    slider: `${uid}-slider`,
    hint: `${uid}-hint`,
    table: `${uid}-table`,
  };

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const next = clampToStep(Number(e.target.value), lo, hi, step);
    setPoint(next);
    if (timer.current) clearTimeout(timer.current);
    const nextValues = replaceAt(ds.values, index, next);
    timer.current = setTimeout(() => {
      setAnnouncement(`${adjustableLabel} set to ${f(next)} ${ds.unit}. ${describeStats(nextValues, ds.unit, spread, decimals)}`);
    }, ANNOUNCE_DELAY_MS);
  }

  // Scales. The y domain is fixed by the slider's max so the axis does not jump while dragging.
  const ticks = niceTicks(0, Math.max(hi, ...ds.values), 4);
  const yMax = ticks[ticks.length - 1] ?? hi;
  const y = linearScale([0, yMax], [H - M.bottom, M.top]);
  const plotW = W - M.left - M.right;
  const band = plotW / values.length;
  const barW = Math.max(4, band * 0.62);

  const yMean = y(stats.mean);
  const yMedian = y(stats.median);
  const xAxis = axisLabels(ds.labels);

  const statRows = [
    { key: "mean", name: "Mean", value: stats.mean, tex: formulas.mean, excel: "AVERAGE" },
    { key: "median", name: "Median", value: stats.median, tex: formulas.median, excel: "MEDIAN" },
    { key: "range", name: "Range", value: stats.range, tex: formulas.range, excel: "MAX - MIN" },
    {
      key: "sd",
      name: spread === "sample" ? "Standard deviation (sample, s)" : "Standard deviation (population, σ)",
      value: stats.stdDev,
      tex: formulas.stdDev,
      excel: spread === "sample" ? "STDEV.S" : "STDEV.P",
    },
  ];

  return (
    <figure aria-labelledby={ids.title} className={cn("rounded-lg border border-border bg-surface p-4 sm:p-6", className)}>
      <figcaption id={ids.title} className="text-lg font-semibold text-fg">
        {label ?? ds.title}
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={describeChart(ds, values)}
        className="mt-4 block h-auto w-full"
        style={{ fontFamily: "var(--fd-font-sans)" }}
      >
        {/* Grid and y axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--fd-border)" strokeWidth={1} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={FONT} fill="var(--fd-fg-muted)">
              {formatNumber(t, 2)}
            </text>
          </g>
        ))}
        <line
          x1={M.left}
          x2={W - M.right}
          y1={H - M.bottom}
          y2={H - M.bottom}
          stroke="var(--fd-border-strong)"
          strokeWidth={1.5}
        />

        {/* Bars */}
        {values.map((v, i) => {
          const isAdjustable = i === index;
          const x = M.left + i * band + (band - barW) / 2;
          return (
            <g key={ds.labels[i] ?? i}>
              <rect
                x={x}
                y={y(v)}
                width={barW}
                height={Math.max(0, H - M.bottom - y(v))}
                rx={3}
                className={motion}
                style={{
                  fill: isAdjustable ? "var(--fd-accent)" : "var(--fd-border-strong)",
                }}
              />
              <text
                x={x + barW / 2}
                y={H - M.bottom + 20}
                textAnchor="middle"
                fontSize={FONT}
                fontWeight={isAdjustable ? 700 : 400}
                fill={isAdjustable ? "var(--fd-accent)" : "var(--fd-fg-muted)"}
              >
                {xAxis.ticks[i]}
              </text>
            </g>
          );
        })}
        {xAxis.title ? (
          <text x={M.left + plotW / 2} y={H - 4} textAnchor="middle" fontSize={FONT} fill="var(--fd-fg-muted)">
            {xAxis.title}
          </text>
        ) : null}

        {/* Median: dashed fg line. Mean: solid accent line. Shape differs as well as colour. */}
        <g className={motion} style={{ transform: `translateY(${yMedian}px)` }}>
          <line x1={M.left} x2={W - M.right} y1={0} y2={0} stroke="var(--fd-fg)" strokeWidth={3} strokeDasharray="8 6" />
        </g>
        <g className={motion} style={{ transform: `translateY(${yMean}px)` }}>
          <line x1={M.left} x2={W - M.right} y1={0} y2={0} stroke="var(--fd-accent)" strokeWidth={3.5} />
        </g>
      </svg>

      {/* Legend (visual only; the same facts are in the chart's accessible name and the stats list) */}
      <ul aria-hidden="true" className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-base text-fg-muted">
        <li className="flex items-center gap-2">
          <svg width="28" height="8" viewBox="0 0 28 8">
            <line x1="0" x2="28" y1="4" y2="4" stroke="var(--fd-accent)" strokeWidth="3.5" />
          </svg>
          <span className="font-semibold text-accent">Mean {f(stats.mean)}</span>
        </li>
        <li className="flex items-center gap-2">
          <svg width="28" height="8" viewBox="0 0 28 8">
            <line x1="0" x2="28" y1="4" y2="4" stroke="var(--fd-fg)" strokeWidth="3" strokeDasharray="8 6" />
          </svg>
          <span className="font-semibold text-fg">Median {f(stats.median)}</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-accent" />
          {adjustableLabel} (you control this)
        </li>
      </ul>

      {/* The one interactive control */}
      <div className="mt-6">
        <label htmlFor={ids.slider} className="flex flex-wrap items-baseline justify-between gap-2 font-medium text-fg">
          <span>Move {adjustableLabel}</span>
          <span className="font-mono text-accent">
            {f(point)} {ds.unit}
          </span>
        </label>
        <input
          id={ids.slider}
          type="range"
          min={lo}
          max={hi}
          step={step}
          value={point}
          onChange={onChange}
          aria-describedby={ids.hint}
          aria-valuetext={`${f(point)} ${ds.unit}`}
          className="mt-2 h-11 w-full cursor-pointer accent-accent"
        />
        <p id={ids.hint} className="text-sm text-fg-muted">
          Arrow keys change it by {formatNumber(step, 4)}; Page Up and Page Down by larger steps; Home and End jump to{" "}
          {f(lo)} and {f(hi)}. Original value: {f(original)} {ds.unit}.
        </p>
      </div>

      {/* Live statistics */}
      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        {statRows.map((row) => (
          <div key={row.key} className="rounded-md bg-surface-2 p-3">
            <dt className="text-sm text-fg-muted">
              {row.name} <span className="font-mono text-xs">({row.excel})</span>
            </dt>
            <dd className="mt-1">
              <span className="text-2xl font-semibold text-fg tabular-nums">
                {f(row.value)} <span className="text-base font-normal text-fg-muted">{ds.unit}</span>
              </span>
              <span className="mt-2 block overflow-x-auto text-sm text-fg">
                <MathTex tex={row.tex} />
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      {/* Accessible data table alternative to the chart */}
      <details className="mt-6 rounded-md border border-border-strong">
        <summary className="cursor-pointer px-3 py-2 font-medium text-fg">Show data table</summary>
        <div className="overflow-x-auto border-t border-border">
          <table id={ids.table} className="w-full border-collapse text-sm">
            <caption className="sr-only">{ds.title}, current values</caption>
            <thead>
              <tr className="bg-surface-2 text-fg-muted">
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Period
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {ds.unit[0]?.toUpperCase()}
                  {ds.unit.slice(1)}
                </th>
              </tr>
            </thead>
            <tbody>
              {values.map((v, i) => (
                <tr key={ds.labels[i] ?? i} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-fg">
                    {ds.labels[i]}
                    {i === index ? <span className="text-fg-muted"> (adjustable)</span> : null}
                  </th>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg">{f(v)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {statRows.map((row) => (
                <tr key={row.key} className="border-t border-border-strong bg-surface-2">
                  <th scope="row" className="px-3 py-1.5 text-left font-semibold text-fg">
                    {row.name}
                  </th>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg">{f(row.value)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </details>
    </figure>
  );
}
