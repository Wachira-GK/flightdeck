import { expect, test } from "@playwright/test";

// Sign-in flow. Everything here runs WITHOUT calling Supabase (the server validates before it calls out),
// except the "live" test at the bottom, which needs a real confirmed account:
//   set FD_E2E_EMAIL=...  and  FD_E2E_PASSWORD=...  before running. It is skipped otherwise.

test("anonymous visitors to the Cockpit are sent to sign in and come back afterwards", async ({ page }) => {
  await page.goto("/cockpit");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fcockpit$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.locator('input[name="next"]')).toHaveValue("/cockpit");
});

test("the sign-in form explains a bad email without contacting Supabase", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("whatever");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a valid email address." })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("not-an-email"); // field is kept, password is not
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("the sign-up form enforces name and password rules on the server", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at least 10 characters" })).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("Ada Lovelace");
});

test("a hostile ?next= is ignored (no open redirect)", async ({ page }) => {
  for (const evil of ["//evil.example", "https://evil.example/x", "/\\evil.example"]) {
    await page.goto(`/sign-in?next=${encodeURIComponent(evil)}`);
    await expect(page.locator('input[name="next"]')).toHaveValue("/cockpit");
  }
});

test("refresh and confirm routes fail safely without credentials", async ({ page }) => {
  await page.goto("/auth/refresh?next=/cockpit");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fcockpit$/);
  await page.goto("/auth/confirm");
  await expect(page).toHaveURL(/\/sign-in\?notice=link-invalid$/);
  await expect(page.getByRole("status").filter({ hasText: "not valid any more" })).toBeVisible();
  await page.goto("/auth/confirm?token_hash=abc&type=recovery"); // recovery links are not accepted here
  await expect(page).toHaveURL(/notice=link-invalid/);
});

test("pages send no session cookie to anonymous visitors", async ({ page, context }) => {
  await page.goto("/sign-in");
  const names = (await context.cookies()).map((c) => c.name);
  expect(names).not.toContain("fd-at");
  expect(names).not.toContain("fd-rt");
});

test.describe("phone width (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const route of ["/sign-in", "/sign-up"]) {
    test(`${route} fits the screen and has touch-sized controls`, async ({ page }) => {
      await page.goto(route);
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
      for (const el of await page.locator("main input:not([type=hidden])").all()) {
        expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      const submit = page.getByRole("button", { name: route === "/sign-in" ? "Sign in" : "Create account" });
      expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    });
  }
});

test.describe("live sign-in (needs FD_E2E_EMAIL and FD_E2E_PASSWORD)", () => {
  test.skip(!process.env.FD_E2E_EMAIL || !process.env.FD_E2E_PASSWORD, "no live test account configured");

  test("wrong password is refused, right password reaches the Cockpit, session cookies are HttpOnly, sign-out ends it", async ({ page, context }) => {
    const email = process.env.FD_E2E_EMAIL!;
    await page.goto("/sign-in?next=/cockpit");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "do not match" })).toBeVisible();

    await page.getByLabel("Password").fill(process.env.FD_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/cockpit$/);
    await expect(page.getByTestId("signed-in-as")).toContainText(email.toLowerCase());
    await expect(page.getByText("learner", { exact: true }).first()).toBeVisible();

    const cookies = await context.cookies();
    for (const name of ["fd-at", "fd-rt"]) {
      const c = cookies.find((x) => x.name === name);
      expect(c, name).toBeTruthy();
      expect(c!.httpOnly).toBe(true);
      expect(c!.sameSite).toBe("Lax");
    }
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/fd-at|fd-rt/); // JavaScript cannot see them

    // Expired access token: only the refresh token is left -> the server renews the session transparently.
    await context.clearCookies({ name: "fd-at" });
    await page.goto("/cockpit");
    await expect(page.getByTestId("signed-in-as")).toContainText(email.toLowerCase());

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in\?notice=signed-out$/);
    await page.goto("/cockpit");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fcockpit$/);
  });
});
