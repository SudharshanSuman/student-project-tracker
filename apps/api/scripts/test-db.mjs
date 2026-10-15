// Applies migrations to the test database before the suite runs.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

let url = process.env.TEST_DATABASE_URL;
if (!url && existsSync("../../.env")) {
  const line = readFileSync("../../.env", "utf8").split("\n").find((l) => l.startsWith("TEST_DATABASE_URL="));
  url = line?.slice("TEST_DATABASE_URL=".length).trim();
}
if (!url) {
  console.error("TEST_DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}
execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
