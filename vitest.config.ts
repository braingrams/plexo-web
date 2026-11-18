import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Tests never call Strata unless they opt in (tests/plexoBrand*.test.ts set it back on).
    env: { PLEXO_BRAND_STRATA: "off" },
    // lambda/project-build is its own package (installed in CI before tests run).
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "lambda/project-build/test/**/*.test.ts"],
  },
});
