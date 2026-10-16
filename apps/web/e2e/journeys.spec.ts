import { test, expect, type Page } from "@playwright/test";

const DEMO_PASSWORD = "DemoPass2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
}

test.describe("Auth & authorization boundaries", () => {
  test("admin can sign in and sees real dashboard data", async ({ page }) => {
    await login(page, "admin@iic.local");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
  });

  test("a plain member is blocked from the admin users page", async ({ page }) => {
    await login(page, "member.priya@iic.local");
    await page.goto("/admin/users");
    // The role gate renders an inline Forbidden state in place of the page content
    // (apps/web/src/app/(app)/layout.tsx) rather than redirecting — URL stays put.
    await expect(page.getByText(/access restricted/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/admin\/users$/);
  });

  test("an unauthenticated visitor is redirected to login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });
});

test.describe("Project creation", () => {
  test("admin creates a project and it appears in the list and detail page", async ({ page }) => {
    await login(page, "admin@iic.local");
    const name = `E2E Test Project ${Date.now()}`;
    await page.goto("/projects");
    await page.getByRole("button", { name: /new project/i }).click();
    await page.locator("#np-name").fill(name);
    await page.locator("#np-desc").fill("Created by the Playwright E2E smoke suite.");
    await page.locator("#np-cat").fill("E2E");
    await page.getByRole("button", { name: /^create project$|^create$/i }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });
});

test.describe("QR attendance: check-in, rejection", () => {
  test("staff opens a session, a member checks in with the live QR token, and an invalid token is rejected", async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await login(adminPage, "admin@iic.local");

    await adminPage.goto("/attendance");
    await adminPage.getByRole("button", { name: /new session/i }).click();
    const sessionName = `E2E Session ${Date.now()}`;
    await adminPage.locator("#as-name").fill(sessionName);
    const now = new Date();
    const start = new Date(now.getTime() - 5 * 60_000);
    const end = new Date(now.getTime() + 60 * 60_000);
    const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await adminPage.locator("#as-start").fill(toLocal(start));
    await adminPage.locator("#as-end").fill(toLocal(end));
    await adminPage.getByRole("button", { name: /^create session$/i }).click();

    // Find the freshly created session in the list and open its detail page.
    await adminPage.getByText(sessionName).click();
    await adminPage.waitForURL(/\/attendance\/[0-9a-f-]+$/, { timeout: 10_000 });

    await adminPage.getByRole("button", { name: /open check-in/i }).click();

    // Capture the live, signed QR token straight from the API response the QR panel itself triggers.
    const qrResponse = await adminPage.waitForResponse((r) => /\/attendance\/sessions\/[0-9a-f-]+\/qr$/.test(r.url()) && r.ok());
    const { token } = (await qrResponse.json()) as { token: string };
    expect(token).toBeTruthy();

    // A real member scans the code (navigates to the check-in URL carrying the token) and checks in.
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await login(memberPage, "member.priya@iic.local");
    await memberPage.goto(`/attendance/check-in?token=${encodeURIComponent(token)}`);
    await memberPage.getByRole("button", { name: /^check in$/i }).click();
    await expect(memberPage.getByText(/checked in to/i)).toBeVisible({ timeout: 10_000 });

    // A well-formed but forged/tampered token must be rejected, not silently accepted.
    const member2Ctx = await browser.newContext();
    const member2Page = await member2Ctx.newPage();
    await login(member2Page, "member.rahul@iic.local");
    const forgedToken = `${"a".repeat(24)}.${"b".repeat(24)}`;
    await member2Page.goto(`/attendance/check-in?token=${encodeURIComponent(forgedToken)}`);
    await member2Page.getByRole("button", { name: /^check in$/i }).click();
    await expect(member2Page.getByText(/not valid/i)).toBeVisible({ timeout: 10_000 });

    await adminCtx.close();
    await memberCtx.close();
    await member2Ctx.close();
  });
});
