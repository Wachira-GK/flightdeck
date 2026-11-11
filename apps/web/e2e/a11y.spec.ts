import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const routes = [
  "/",
  "/cockpit",
  "/missions/excel-sum-101",
  "/missions/excel-sum-101?step=simulation",
  "/missions/descriptive-stats-101?step=training",
  "/missions/descriptive-stats-101?step=simulation",
  "/missions/descriptive-stats-101?step=assessment",
  "/catalogue",
  "/missions/excel-if-102?step=simulation",
  "/missions/excel-lookup-103?step=simulation",
];

async function axe(page: Page) {
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
}

for (const route of routes) {
  test(`axe: no WCAG A/AA violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await axe(page);
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`);
    expect(summary, summary.join("\n")).toEqual([]);
  });

  test(`landmarks and single h1 on ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
  });
}

test("skip link is the first tab stop, is visible on focus and moves focus to main", async ({ page }) => {
  await page.goto("/cockpit");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
});

test("focused elements show a visible outline", async ({ page }) => {
  await page.goto("/cockpit");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(outline.style).toBe("solid");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});

test("step rail is keyboard operable and marks the current step", async ({ page }) => {
  await page.goto("/missions/excel-sum-101");
  const rail = page.getByRole("navigation", { name: "Mission steps" });
  await expect(rail.getByRole("link", { name: /Briefing/ })).toHaveAttribute("aria-current", "step");

  const simulation = rail.getByRole("link", { name: /Simulation/ });
  await simulation.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/step=simulation/);
  await expect(rail.getByRole("link", { name: /Simulation/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { level: 2, name: "Simulation" })).toBeVisible();
  // The Simulation step now hosts the interactive Excel grid (role=grid, not the old static table).
  await expect(page.getByRole("grid")).toBeVisible();
});

test("tab order on the mission page follows reading order", async ({ page }) => {
  await page.goto("/missions/excel-sum-101");
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(() => (document.activeElement?.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
  }
  const idx = (label: string) => order.findIndex((t) => t.includes(label));
  expect(idx("Skip to main content")).toBe(0);
  expect(idx("Cockpit")).toBeLessThan(idx("Briefing"));
  expect(idx("Briefing")).toBeLessThan(idx("Training"));
  expect(idx("Training")).toBeLessThan(idx("Debrief"));
});

test("health route handler returns JSON", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", service: "flightdeck-web" });
});

test("unknown mission renders not-found", async ({ page }) => {
  // No route-level loading.tsx on missions, so notFound() runs before streaming: a real 404.
  const res = await page.goto("/missions/does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Off the flight plan");
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
});

test("reduced motion collapses token durations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/cockpit");
  const d = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--fd-duration-base").trim(),
  );
  expect(d).toMatch(/^0m?s$/); // minifier may emit 0s
});

test("Excel simulation: typing =SUM(B2:B4) in B5 shows 358", async ({ page }) => {
  await page.goto("/missions/excel-sum-101?step=simulation");
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  const b5 = grid.locator('[aria-label^="B5"]').first();
  await b5.click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("=SUM(B2:B4)");
  await page.keyboard.press("Enter");
  await expect(grid.locator('[aria-label^="B5"]').first()).toContainText("358");
});

test("Stats explorer: moving the outlier changes the mean but not the median", async ({ page }) => {
  await page.goto("/missions/descriptive-stats-101?step=simulation");
  const slider = page.getByRole("slider").first();
  await expect(slider).toBeVisible();
  const main = page.locator("main");
  await expect(main).toContainText("Mean 162.5");
  await expect(main).toContainText("Median 147");
  // Push the outlier further up (End = 400): the mean follows, the median does not.
  await slider.focus();
  await page.keyboard.press("End");
  await expect(main).not.toContainText("Mean 162.5");
  await expect(main).toContainText("Median 147");
});

test("Maths assessment is graded by the server and only reveals solutions on a pass", async ({ page }) => {
  await page.goto("/missions/descriptive-stats-101?step=assessment");
  await page.getByLabel(/mean number of pairs Store B/i).fill("1");
  await page.getByRole("button", { name: "Submit assessment" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("You need 75% to pass");
  await expect(page.locator("main")).not.toContainText("105.2");

  await page.getByLabel(/mean number of pairs Store B/i).fill("105.2");
  await page.getByLabel(/median number of pairs Store B/i).fill("90");
  await page.getByLabel(/sample standard deviation/i).fill("50.86");
  await page.getByRole("radio", { name: "The median" }).check();
  await page.getByRole("button", { name: "Submit assessment" }).click();
  await expect(status).toContainText("Passed");
  await expect(status).toContainText("100%");
});

test("Catalogue links to every published mission and the lesson pages load", async ({ page }) => {
  await page.goto("/catalogue");
  for (const code of ["EX-101", "EX-102", "EX-103", "MA-101"]) {
    const link = page.getByRole("link", { name: new RegExp(`Start mission ${code}`) });
    await expect(link).toBeVisible();
  }
  await page.getByRole("link", { name: /Start mission EX-103/ }).click();
  await expect(page.locator("h1")).toContainText("XLOOKUP");
});
