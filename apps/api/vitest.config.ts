import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

function testDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const file = new URL("../../.env", import.meta.url);
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("TEST_DATABASE_URL="));
    if (line) return line.slice("TEST_DATABASE_URL=".length).trim();
  }
  throw new Error("TEST_DATABASE_URL is required for API tests");
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // One shared Postgres test database: run files sequentially.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDbUrl(),
      QR_TOKEN_SECRET: "test-secret-test-secret-test-secret-0123456789",
      INSTITUTION_EMAIL_DOMAINS: "uni.test",
      WEB_ORIGIN: "http://localhost:3000",
      APP_URL: "http://localhost:3000",
      // Generated PDFs go to a throwaway directory, never the dev storage.
      STORAGE_DIR: mkdtempSync(path.join(tmpdir(), "iic-test-storage-")),
      REPORT_CONCURRENCY: "1",
    },
  },
});
