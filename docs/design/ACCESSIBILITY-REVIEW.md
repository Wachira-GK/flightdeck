# Accessibility review: G1 prototypes

Status: **automated and scripted checks pass. Human review is pending.**
Scope: `/`, `/cockpit`, `/missions/excel-sum-101` (all five steps), not-found, and the loading and error states.
Target: WCAG 2.2 AA. Date: 11 Nov 2026. Reviewer of record: _pending (human)_.

## How to reproduce

```powershell
pnpm --filter @flightdeck/ui test          # token contrast gate (70 pairs)
pnpm --filter @flightdeck/web build
pnpm --filter @flightdeck/web test:e2e     # Playwright + axe-core, light and dark, using installed Edge (no download)
# Same suite against the Cloudflare workerd preview:
#   terminal 1: pnpm --filter @flightdeck/web cf:preview
#   terminal 2: $env:PW_BASE_URL="http://127.0.0.1:8787"; pnpm --filter @flightdeck/web test:e2e
```

E2E is kept out of `pnpm test` so that a browser problem can never break unit CI. On Windows it uses the installed Microsoft Edge (`channel: msedge`); elsewhere it uses Chrome. Set `PW_CHANNEL` to override. No Playwright browser download is needed, and no admin rights.

## What was checked

| Check | Method | Result |
|---|---|---|
| Colour contrast of all token pairs, light and dark | `contrast.test.ts` (WCAG 2.2 formula, parses `tokens.css`) | **Pass**: 70/70. Min text ratio 5.09:1. Min UI/focus ratio 3.75:1. Details in `TOKENS.md` |
| Automated WCAG 2.0/2.1/2.2 A+AA rules on 4 URLs × 2 colour schemes | `@axe-core/playwright` 4.14 (`e2e/a11y.spec.ts`) | **Pass**: 0 violations (also checks rendered contrast, ARIA, names and roles) |
| Landmarks | E2E: exactly one `banner`, `main`, `contentinfo`, plus `navigation "Primary"` | **Pass** on every route. Mission page adds `nav "Breadcrumb"`, `complementary "Mission navigation"` and `nav "Mission steps"` |
| Headings | E2E: exactly one `h1` per page. Sections use `h2`/`h3` in order with `aria-labelledby` | **Pass** |
| Skip link | E2E: first Tab stop, visible on focus, Enter moves focus to `<main id="main" tabindex="-1">` | **Pass** |
| Focus visibility | Global `:focus-visible` outline, 3 px solid `--fd-focus` with 2 px offset. E2E checks the computed outline is solid and ≥ 2 px | **Pass** (contrast of the ring ≥ 5.59:1 on every surface) |
| Logical tab order | E2E on the mission page: skip link → header → breadcrumb → Briefing → Training → … → Debrief → content → Prev/Next | **Pass** |
| Step rail keyboard operation | Rail items are native links (Tab/Shift+Tab/Enter, works without JS). The current step has `aria-current="step"`, and completed steps have SR text "(completed)". E2E moves to Simulation with the keyboard and checks `aria-current` and the new `h2` | **Pass** |
| Primary nav state | `aria-current="page"` on the active nav link | Implemented |
| Progress | `role="progressbar"` with `aria-label`, `aria-valuenow`, `aria-valuetext="N% complete"`. The percentage is also shown as text | Implemented, axe pass |
| Locked track (CodeVerse SQL) | Not a link and not focusable. Shown with a "Locked" text badge and an icon (`aria-hidden`), plus a dashed strong border. State does not rely on colour alone | Implemented |
| Simulation placeholder grid | `<table>` with `<caption>`, `th scope=col/row`. Target cell input is `readOnly` with an `aria-label` and an `aria-describedby` note saying it is not active. No eval/new Function (ESLint `no-eval`, `no-implied-eval`, `no-new-func` = error) | Implemented, axe pass |
| Loading states | `loading.tsx` for `/cockpit` and the mission route: `role="status"` + `aria-live="polite"` with SR text. The skeleton is `aria-hidden` | Implemented (code review). Not exercised visually because mock data resolves instantly |
| Error states | `error.tsx` for both routes: `role="alert"`, focus moves to the error `h1`, "Try again" button calls `reset()` | Implemented (code review). Not triggered in E2E |
| Not found | Unknown mission → `notFound()` → "Off the flight plan" + `noindex`. Because `loading.tsx` streams, the HTTP status is 200 (Next.js soft 404). Recorded as a known limitation | **Pass** (content), see note |
| Reduced motion | Duration tokens drop to `0ms` and a global transition/animation clamp applies. Checked by unit test and by E2E with `emulateMedia({ reducedMotion: "reduce" })` | **Pass** |
| Dark mode | Every axe and keyboard test runs in both `light` and `dark` Playwright projects | **Pass** |
| Text resize / reflow | rem-based type scale, responsive grid (rail becomes a horizontal list under `lg`) | Implemented. **Not yet measured** at 400% / 320 CSS px |
| Language | `<html lang="en">` | Implemented |

E2E totals: **30/30 passed** against `next start` (Node), and **30/30 passed** against the Cloudflare workerd preview.

## Still needs human review

1. **Screen reader pass:** NVDA + Edge/Firefox on Windows, and VoiceOver + Safari on macOS/iOS. Check the reading order of the Cockpit, how the step rail is announced ("current step"), progressbar announcements, the locked-track wording, the grid caption, and that the loading status is announced once.
2. **Reflow and zoom:** 320 CSS px width and 400% zoom (SC 1.4.10), text spacing override (SC 1.4.12).
3. **Visual focus review:** confirm the ring is never clipped (`overflow-x-auto` rail on small screens, table input).
4. **Target size:** SC 2.5.8 (24×24 minimum). Buttons are 36–48 px high. Breadcrumb links and inline links need a manual check.
5. **Soft 404 status:** decide whether to drop `loading.tsx` from the mission route or validate the slug earlier so unknown missions return a real 404.
6. **Content and cognitive review** of the copy (plain language, mission vocabulary for non-native English speakers).
7. **Windows High Contrast / forced-colors** mode: check the focus outline and the progress fill (the fill is a background colour and may disappear; consider `forced-color-adjust` or a border).

Automated tools catch only part of WCAG. These results are evidence for review, not a conformance claim.
