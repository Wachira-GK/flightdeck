import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const routes = [
  "/",
  "/sign-in",
  "/sign-up",
  "/missions/excel-sum-101",
  "/missions/excel-sum-101?step=simulation",
  "/missions/descriptive-stats-101?step=training",
  "/missions/descriptive-stats-101?step=simulation",
  "/missions/descriptive-stats-101?step=assessment",
  "/catalogue",
  "/missions/excel-if-102?step=simulation",
  "/missions/excel-lookup-103?step=simulation",
  "/missions/excel-sum-101?step=assessment",
  "/missions/excel-if-102?step=assessment",
  "/missions/excel-lookup-103?step=assessment",
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
  await page.goto("/catalogue");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
});

test("focused elements show a visible outline", async ({ page }) => {
  await page.goto("/catalogue");
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
  await page.goto("/catalogue");
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

test("Excel assessment is graded by the server and only reveals explanations on a pass", async ({ page }) => {
  await page.goto("/missions/excel-sum-101?step=assessment");
  await page.getByLabel(/Kisumu store/i).fill("1");
  await page.getByRole("button", { name: "Submit assessment" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("You need 80% to pass");
  await expect(page.locator("main")).not.toContainText(/\b145\b|\b368\b|covers all twelve months/);

  await page.getByRole("radio", { name: "=SUM(B2:B13)", exact: true }).check();
  await page.getByLabel(/Kisumu store/i).fill("145");
  await page.getByRole("radio", { name: "=SUM(C2:C4)", exact: true }).check();
  await page.getByLabel(/Finance corrects February/i).fill("368");
  await page.getByRole("button", { name: "Submit assessment" }).click();
  await expect(status).toContainText("Passed");
  await expect(status).toContainText("100%");
  await expect(page.locator("main")).toContainText("45 + 62 + 38 = 145K");
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

test.describe("phone width (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const route of [
    "/sign-in",
    "/sign-up",
    "/catalogue",
    "/missions/excel-sum-101?step=simulation",
    "/missions/excel-lookup-103?step=simulation",
    "/missions/excel-sum-101?step=assessment",
    "/missions/excel-if-102?step=assessment",
    "/missions/excel-lookup-103?step=assessment",
    "/missions/descriptive-stats-101?step=simulation",
    "/missions/descriptive-stats-101?step=training",
  ]) {
    test(`no sideways page scroll on ${route}`, async ({ page }) => {
      await page.goto(route);
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
    });
  }

  test("starter values show immediately in the Excel grid", async ({ page }) => {
    await page.goto("/missions/excel-sum-101?step=simulation");
    await expect(page.getByRole("grid").locator('[aria-label^="B2"]').first()).toContainText("120");
    // (Next's route announcer also uses role=alert, so check for the engine messages specifically.)
    await expect(page.locator("main")).not.toContainText(/took longer than|engine stopped/i);
  });

  test("Excel assessment form is usable at 375px and fits the screen", async ({ page }) => {
    await page.goto("/missions/excel-sum-101?step=assessment");
    const submit = page.getByRole("button", { name: "Submit assessment" });
    await submit.scrollIntoViewIfNeeded();
    const box = await submit.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.height).toBeGreaterThanOrEqual(24);
    await page.getByLabel(/Kisumu store/i).fill("145");
    await submit.click();
    await expect(page.getByRole("status")).toContainText("You need 80% to pass");
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test("menu button opens, navigates and closes with Escape", async ({ page }) => {
    await page.goto("/catalogue");
    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    await menu.click();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Catalogue" }).click();
    await expect(page).toHaveURL(/\/catalogue$/);
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  });
});
