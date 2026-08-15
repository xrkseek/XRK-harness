import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Kernel-only coverage gate (S4-18): lines/functions/branches/statements ≥ 90%.
 * Kept separate from the full suite so monorepo coverage does not dilute the threshold.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@xrkseek/kernel": path.join(root, "packages/kernel/src/index.ts"),
    },
  },
  test: {
    include: ["packages/kernel/tests/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["packages/kernel/src/**/*.ts"],
      exclude: ["packages/kernel/src/index.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
