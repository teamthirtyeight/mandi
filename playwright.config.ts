// End-to-end UI tests in your installed Chrome against a separate database
// (mandi_e2e) with the model off, so runs are free and deterministic.
//   createdb mandi_e2e && DATABASE_URL=postgres://localhost:5432/mandi_e2e npx drizzle-kit push
//   npm run test:e2e
import { defineConfig } from "@playwright/test";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/mandi_e2e";
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", headless: true },
  webServer: {
    command: `npx next dev --turbopack -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DB,
      MANDI_FAKE_AI: "1",
      MANDI_TURN_DELAY_MS: "0",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      CHANNEL3_API_KEY: "",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
