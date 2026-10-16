import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E smoke tests. Runs against the dev API+web servers backed by the
 * seeded dev database (not the vitest-managed test DB). Uses the system Chrome
 * install (channel: "chrome") instead of downloading Playwright's own browser.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: "npm run dev",
    cwd: "../..",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
