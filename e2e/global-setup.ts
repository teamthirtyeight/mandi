import { execSync } from "node:child_process";

export default function globalSetup() {
  const db = process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/mandi_e2e";
  execSync("npx tsx lib/db/seed.ts", { env: { ...process.env, DATABASE_URL: db }, stdio: "inherit" });
}
