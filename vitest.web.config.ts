/**
 * Product-shell browser lane. Root vitest.config.ts only includes `*.test.ts`
 * (`pnpm check`); this config is `pnpm test:web` only.
 *
 * Do not glob every apps/web e2e file — those still assume the DSH Cordis
 * launchWebScaffold composition and are not this Host-serve lane.
 */
import { defineConfig } from "vitest/config";
import unit from "./vitest.config.ts";

export default defineConfig({
  resolve: unit.resolve,
  test: {
    include: [
      "apps/web/tests/product-shell-chrome.e2e.ts",
      "apps/web/tests/product-shell-stream.e2e.ts",
      "apps/web/tests/product-shell-cancel.e2e.ts",
      "apps/web/tests/product-shell-tool.e2e.ts",
      "apps/web/tests/product-shell-approval.e2e.ts",
      "apps/web/tests/product-shell-inventory.e2e.ts",
      "apps/web/tests/product-shell-question.e2e.ts",
      "apps/web/tests/product-shell-thinking.e2e.ts",
      "apps/web/tests/product-shell-todo.e2e.ts",
      "apps/web/tests/product-shell-access.e2e.ts",
      "apps/web/tests/product-shell-plan.e2e.ts",
      "apps/web/tests/product-shell-plan-review.e2e.ts",
      "apps/web/tests/product-shell-export.e2e.ts",
      "apps/web/tests/product-shell-mcp.e2e.ts",
    ],
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
