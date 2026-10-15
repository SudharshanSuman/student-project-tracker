#!/usr/bin/env node
// Runs the API and web dev servers together (Ctrl+C stops both).
// Start the database first: `npm run db:start` (or point DATABASE_URL at any Postgres).
import { spawn } from "node:child_process";

const procs = [
  ["api", ["run", "dev", "-w", "@iic/api"]],
  ["web", ["run", "dev", "-w", "@iic/web"]],
].map(([name, args]) => {
  const p = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
  const tag = (chunk) => chunk.toString().split("\n").filter(Boolean).map((l) => `[${name}] ${l}`).join("\n") + "\n";
  p.stdout.on("data", (c) => process.stdout.write(tag(c)));
  p.stderr.on("data", (c) => process.stderr.write(tag(c)));
  p.on("exit", (code) => {
    console.log(`[${name}] exited with ${code}`);
    procs.forEach((o) => o.kill());
    process.exit(code ?? 0);
  });
  return p;
});
process.on("SIGINT", () => procs.forEach((p) => p.kill("SIGINT")));
