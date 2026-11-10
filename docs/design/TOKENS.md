# FlightDeck design tokens (G1)

Status: draft for human review. Owner: design/front-end. Last verified: 11 Nov 2026.

- **Source of truth:** `packages/ui/src/tokens/tokens.css` (CSS custom properties, prefix `--fd-`).
- **Tailwind mapping:** `apps/web/app/globals.css` (`@theme inline`), which gives utilities such as `bg-surface`, `text-fg-muted`, `border-border-strong` and `rounded-lg`.
- **Allowed colour pairs:** `packages/ui/src/tokens/pairs.ts`.
- **Contrast gate (G1 evidence):** `packages/ui/test/contrast.test.ts`. It parses `tokens.css` directly, so it checks the values that actually ship. Run it with `pnpm --filter @flightdeck/ui test`.

Direction: about 70% Apple-style minimalism (system fonts, generous whitespace, quiet surfaces) and 30% DataCamp-style interactivity (clear progress, an obvious next action). The palette is a deep navy "instrument panel" with **one accent** (instrument cyan). Success, warning and danger are status colours only. They never decorate.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--fd-bg` | `#f5f7fb` | `#07111f` | Page background |
| `--fd-surface` | `#ffffff` | `#0d1b2e` | Cards, header |
| `--fd-surface-2` | `#eaeef5` | `#13243b` | Sunken areas, locked track, grid headers |
| `--fd-fg` | `#0b1b33` | `#e8eef7` | Body and heading text |
| `--fd-fg-muted` | `#4a5a73` | `#a3b1c6` | Secondary text |
| `--fd-border` | `#d5dce6` | `#22344d` | Decorative dividers only (not a meaningful boundary) |
| `--fd-border-strong` | `#6b7a90` | `#7d8ea8` | Control borders, grid lines, locked outline (UI ≥ 3:1) |
| `--fd-accent` | `#0a6680` | `#5cd0ee` | The single accent: primary button, links, active step, progress |
| `--fd-accent-fg` | `#ffffff` | `#07111f` | Text on the accent |
| `--fd-accent-subtle` | `#e3f2f7` | `#0f2d42` | Active nav/step background, next-step band |
| `--fd-focus` | `#0a6680` | `#5cd0ee` | Focus ring |
| `--fd-success` / `--fd-warning` / `--fd-danger` | `#1d6b3c` / `#8a5a00` / `#b42318` | `#5fd38d` / `#f2c14e` / `#ff8a80` | Status text and icons |
| `--fd-track` | `#d5dce6` | `#22344d` | Progress track |

Theme selection: dark follows `prefers-color-scheme: dark` unless `<html data-theme="light">` forces light. `data-theme="dark"` forces dark. The test checks that the media-query block and the `data-theme="dark"` block are identical.

### Contrast results (WCAG 2.2 AA)

Ratios are rounded **down** to 2 dp. Text must be ≥ 4.5:1 (SC 1.4.3). Focus rings and meaningful UI boundaries must be ≥ 3:1 (SC 1.4.11 / 2.4.13).

| Foreground | Min | Light: bg | surface | surface-2 | accent-subtle | Dark: bg | surface | surface-2 | accent-subtle |
|---|---|---|---|---|---|---|---|---|---|
| `--fd-fg` | 4.5 | 16.06 | 17.22 | 14.80 | 15.02 | 16.23 | 14.83 | 13.40 | 12.21 |
| `--fd-fg-muted` | 4.5 | 6.52 | 6.99 | 6.01 | 6.10 | 8.71 | 7.96 | 7.19 | 6.55 |
| `--fd-accent` | 4.5 | 6.07 | 6.51 | 5.59 | 5.67 | 10.56 | 9.65 | 8.71 | 7.94 |
| `--fd-success` | 4.5 | 6.07 | 6.52 | 5.60 | 5.68 | 10.08 | 9.22 | 8.33 | 7.58 |
| `--fd-warning` | 4.5 | 5.52 | 5.92 | **5.09** | 5.16 | 11.28 | 10.31 | 9.31 | 8.48 |
| `--fd-danger` | 4.5 | 6.12 | 6.57 | 5.64 | 5.73 | 8.29 | 7.58 | 6.84 | 6.23 |
| `--fd-focus` | 3.0 | 6.07 | 6.51 | 5.59 | 5.67 | 10.56 | 9.65 | 8.71 | 7.94 |
| `--fd-border-strong` | 3.0 | 4.06 | 4.36 | **3.75** | 3.80 | 5.68 | 5.19 | 4.69 | 4.27 |

Other pairs: `--fd-accent-fg` on `--fd-accent` is 6.51 (light) and 10.56 (dark). The progress fill `--fd-accent` on `--fd-track` is 4.71 (light) and 7.02 (dark).

**Result: 70 pairs checked (35 per theme), 0 failures.** The minimum text ratio is **5.09:1** (light warning on surface-2). The minimum UI ratio is **3.75:1** (light border-strong on surface-2).

Rule: before you use a new foreground/background combination in a component, add it to `pairs.ts`. CI then fails if the pair is below AA.

## Typography

System font stack, so no web-font download: SF Pro on Apple, Segoe UI Variable on Windows. The scale is roughly 1.25.

| Token | rem | px |
|---|---|---|
| `--fd-text-xs` | 0.75 | 12 |
| `--fd-text-sm` | 0.875 | 14 |
| `--fd-text-base` | 1 | 16 |
| `--fd-text-lg` | 1.125 | 18 |
| `--fd-text-xl` | 1.25 | 20 |
| `--fd-text-2xl` | 1.5 | 24 |
| `--fd-text-3xl` | 1.875 | 30 |
| `--fd-text-4xl` | 2.25 | 36 |
| `--fd-text-5xl` | 3 | 48 |

Line height is `--fd-leading-tight` 1.2 for headings and `--fd-leading-normal` 1.5 for body text. All sizes are in rem, so they respect the user's browser font size (SC 1.4.4).

## Spacing, radius, motion

- **Spacing:** 4 px grid: `--fd-space-1` (4) through `--fd-space-16` (64). Tailwind's default spacing scale uses the same 4 px base.
- **Radius:** `sm` 6 px, `md` 10 px, `lg` 16 px, `xl` 24 px, `full`.
- **Motion:** `--fd-duration-fast` 120 ms, `--fd-duration-base` 200 ms, `--fd-duration-slow` 320 ms. Easing is `--fd-ease-standard` `cubic-bezier(0.2,0,0,1)`.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, every duration token becomes `0ms`, and a global rule shortens CSS animations and transitions to 0.01 ms. The unit test asserts this, and the E2E test checks the computed value in a real browser.
- **Focus:** `--fd-focus-width` 3 px, `--fd-focus-offset` 2 px. This is applied globally through `:focus-visible` in `globals.css`.

## Components (shadcn pattern, hand-written)

`packages/ui/src/components/`: `Button` / `buttonVariants` (cva), `Card`, `CardEyebrow`, `Badge`, and `Progress` (`role="progressbar"` with `aria-valuenow`/`aria-valuetext`). Class names are merged with `cn()` (clsx + tailwind-merge).
