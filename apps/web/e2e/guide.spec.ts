import { test, expect, type Page } from "@playwright/test";

const DEMO_PASSWORD = "DemoPass2026";

// The tour skips auto-opening in automated browsers so it never covers other tests;
// these tests pretend to be a normal browser to exercise the first-visit behaviour.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

test.describe("Welcome tour", () => {
  test("opens on first sign-in, can be completed, and stays closed afterwards", async ({ page }) => {
    await login(page, "member.priya@iic.local");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /welcome, /i })).toBeVisible();

    await dialog.getByRole("button", { name: /show me around/i }).click();
    await expect(dialog.getByRole("heading", { name: /dashboard/i })).toBeVisible();
    await dialog.getByRole("button", { name: /back/i }).click();
    await expect(dialog.getByRole("heading", { name: /welcome, /i })).toBeVisible();

    // Step to the end; members get no role-specific extra step.
    for (let i = 0; i < 10 && (await dialog.getByRole("button", { name: /^(show me around|next)/i }).count()); i++) {
      await dialog.getByRole("button", { name: /^(show me around|next)/i }).click();
    }
    await expect(dialog.getByRole("heading", { name: /you're all set/i })).toBeVisible();
    await dialog.getByRole("button", { name: /get started/i }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole("heading", { name: /dashboard/i }).first()).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();

    // Reopen any time from the top bar.
    await page.getByRole("button", { name: /open the user guide/i }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /welcome, /i })).toBeVisible();
  });

  test("is tailored to the role", async ({ page }) => {
    await login(page, "lead.arjun@iic.local");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /welcome, /i })).toBeVisible();
    await expect(dialog.getByTestId("guide-body")).toContainText(/project lead/i);
    const titles: string[] = [];
    for (let i = 0; i < 10; i++) {
      titles.push((await dialog.getByRole("heading").first().textContent()) ?? "");
      const next = dialog.getByRole("button", { name: /^(show me around|next)/i });
      if (!(await next.count())) break;
      await next.click();
    }
    expect(titles).toContain("Keep the funding ledger");
    expect(titles).not.toContain("Invite your people");
  });

  test("a step link opens that page and closes the tour", async ({ page }) => {
    await login(page, "mentor.rao@iic.local");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /show me around/i }).click();
    await dialog.getByRole("button", { name: /next/i }).click();
    await dialog.getByRole("link", { name: /open kanban board/i }).click();
    await page.waitForURL(/\/board/);
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
