#!/usr/bin/env node
/**
 * Local development PostgreSQL without Docker or a system install.
 *
 * Uses the `embedded-postgres` npm package (real PostgreSQL 17 binaries) and keeps
 * the data directory in ./.dev-db. Creates the `iic_dev` and `iic_test` databases.
 * Leave this running in its own terminal; Ctrl+C stops the server cleanly.
 *
 * If you already have a reachable Postgres (Docker Compose, a hosted instance, a
 * system install) you do not need this script: just set DATABASE_URL.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const databaseDir = resolve(process.cwd(), ".dev-db");
const user = "iic";
const password = "iic_dev_password";

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
  onLog: () => {},
  onError: (err) => console.error("[dev-db]", err),
});

const fresh = !existsSync(resolve(databaseDir, "PG_VERSION"));
if (fresh) {
  console.log(`[dev-db] initialising cluster in ${databaseDir}`);
  await pg.initialise();
}
await pg.start();

for (const db of ["iic_dev", "iic_test"]) {
  try {
    await pg.createDatabase(db);
    console.log(`[dev-db] created database ${db}`);
  } catch (err) {
    if (!String(err?.message ?? err).includes("already exists")) throw err;
  }
}

console.log(`[dev-db] PostgreSQL ready on port ${port}`);
console.log(`[dev-db] DATABASE_URL=postgresql://${user}:${password}@localhost:${port}/iic_dev`);

const shutdown = async () => {
  console.log("\n[dev-db] stopping…");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
