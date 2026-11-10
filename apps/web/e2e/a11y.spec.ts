import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const routes = ["/", "/cockpit", "/missions/excel-sum-101", "/missions/excel-sum-101?step=simulation"];

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
  await expect(page.getByRole("table")).toBeVisible();
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
  // With loading.tsx streaming, Next sends 200 + <meta name="robots" content="noindex"> (soft 404).
  const res = await page.goto("/missions/does-not-exist");
  expect([200, 404]).toContain(res?.status());
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
