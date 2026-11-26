import { test, expect } from "@playwright/test";

// Guards "install the app" on Android, iOS and desktop. Every check runs logged out,
// because browsers fetch these files before (and regardless of) signing in.
test.describe("Installable web app (PWA)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("manifest and icons are served to logged-out visitors", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest).toMatchObject({ name: "IIC Platform", short_name: "IIC", display: "standalone", start_url: "/dashboard" });
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);

    for (const src of [...manifest.icons.map((i: { src: string }) => i.src), "/apple-touch-icon.png"]) {
      const icon = await request.get(src, { maxRedirects: 0 });
      expect(icon.status(), src).toBe(200);
      expect(icon.headers()["content-type"], src).toBe("image/png");
    }
  });

  test("service worker is served at the root scope without caching", async ({ request }) => {
    const res = await request.get("/sw.js", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-cache");
    expect(await res.text()).toContain('addEventListener("fetch"');
  });

  test("install tags are in <head>, where Chrome and iOS Safari read them", async ({ page }) => {
    await page.goto("/login");
    // Next.js streams metadata into <body> on dynamic routes unless htmlLimitedBots is set;
    // browsers ignore a manifest link there, so the install option silently disappears.
    const inHead = await page.evaluate(() =>
      [
        'link[rel="manifest"]',
        'link[rel="apple-touch-icon"]',
        'meta[name="apple-mobile-web-app-title"]',
        'meta[name="mobile-web-app-capable"]',
        'meta[name="theme-color"]',
      ].map((sel) => [sel, document.querySelector(sel)?.parentElement?.tagName ?? "missing"]),
    );
    for (const [sel, parent] of inHead) expect(parent, sel).toBe("HEAD");
  });
});
