import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  // DB-backed test files share one database, so run files one at a time.
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});
