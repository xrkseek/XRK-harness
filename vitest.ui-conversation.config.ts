import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import unit from "./vitest.config.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite object aliases are prefix-matched in insertion order, so a package-root
 * alias (e.g. `@xrkseek/xrk-llm`) swallows its own subpaths unless they are
 * inserted first. `mergeConfig` appends this lane's keys after the unit map's,
 * so the merged map is re-sorted longest-key-first below instead of relying on
 * literal order.
 */
function longestFirst(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map).sort(([a], [b]) => b.length - a.length),
  );
}

const config = mergeConfig(
  unit,
  defineConfig({
    test: {
      include: [
        "packages/client/ui-conversation/tests/**/*.client.spec.ts",
        "packages/client/ui-conversation/tests/**/*.client.spec.tsx",
        "packages/client/ui-attachment/tests/**/*.client.spec.ts",
        "packages/client/ui-attachment/tests/**/*.client.spec.tsx",
        "packages/client/ui-deliverables/tests/**/*.client.spec.ts",
        "packages/client/ui-deliverables/tests/**/*.client.spec.tsx",
        "packages/client/ui-schedule/tests/**/*.client.spec.ts",
        "packages/client/ui-schedule/tests/**/*.client.spec.tsx",
        "packages/client/ui-layout/tests/shell-shortcuts.client.spec.ts",
        "packages/client/ui-primitives/tests/shortcuts-panel.client.spec.tsx",
        "packages/client/ui-workspace/tests/tree.client.spec.ts",
        "packages/client/ui-settings-plugins/tests/apply.client.spec.ts",
        "packages/client/ui-settings-plugins/tests/info-cards.client.spec.ts",
      ],
      environment: "jsdom",
      // Same jsdom repairs as the client lane (Lexical Range geometry,
      // DataTransfer, PointerEvent) — composer setDraft otherwise throws.
      setupFiles: ["./vitest.client.setup.ts"],
    },
    resolve: {
      alias: {
        "@xrkseek/client-test-runtime": path.join(
          root,
          "packages/stubs/xrk-client-test-runtime/src/index.ts",
        ),
        // The bench imports these two by name; both ship unbuilt `lib/` halves,
        // so they reach their TypeScript entries the way the client lane does.
        "@xrkseek/client-web-react": path.join(
          root,
          "packages/client/web-react/src/index.ts",
        ),
        "@xrkseek/xrk-api-remotes/client": path.join(
          root,
          "packages/stubs/xrk-api-remotes/src/client/index.ts",
        ),
        "@xrkseek/xrk-attachment": path.join(
          root,
          "packages/stubs/xrk-attachment/src/index.ts",
        ),
        "@xrkseek/client-runtime/client": path.join(
          root,
          "packages/client/runtime/src/client/index.ts",
        ),
        "@xrkseek/client-locale/client": path.join(
          root,
          "packages/client/locale/src/client/index.ts",
        ),
        "@xrkseek/xrk-invariants": path.join(
          root,
          "packages/stubs/xrk-invariants/src/index.ts",
        ),
        "@xrkseek/xrk-llm/brand": path.join(
          root,
          "packages/stubs/xrk-llm/src/brand.ts",
        ),
        "@xrkseek/xrk-llm/message": path.join(
          root,
          "packages/stubs/xrk-llm/src/message.ts",
        ),
        "@xrkseek/xrk-llm/types": path.join(
          root,
          "packages/stubs/xrk-llm/src/types.ts",
        ),
        "@xrkseek/xrk-llm-retry/types": path.join(
          root,
          "packages/stubs/xrk-llm-retry/src/types.ts",
        ),
        "@xrkseek/client-ui-primitives": path.join(
          root,
          "packages/client/ui-primitives/src/index.ts",
        ),
        "@xrkseek/client-ui-slots": path.join(
          root,
          "packages/client/ui-slots/src/index.ts",
        ),
        // Both Settings surfaces ship CJS bundles whose `lib/client.js` cannot
        // be loaded by this lane's ESM transform, so specs reach their source.
        "@xrkseek/client-ui-settings/client": path.join(
          root,
          "packages/client/ui-settings/src/client/index.ts",
        ),
        "@xrkseek/client-ui-settings-plugins/client": path.join(
          root,
          "packages/client/ui-settings-plugins/src/client/index.ts",
        ),
        // Reached through the settings scope above; its own package entry is not
        // resolvable from this lane.
        "@xrkseek/client-schema-form": path.join(
          root,
          "packages/client/schema-form/src/index.ts",
        ),
        "@xrkseek/client-locale/src/locales/zh.ts": path.join(
          root,
          "packages/client/locale/src/locales/zh.ts",
        ),
        "@testing-library/react": path.join(
          root,
          "packages/client/ui-conversation/node_modules/@testing-library/react",
        ),
        keytar: path.join(
          root,
          "packages/stubs/xrk-client-test-runtime/keytar-stub.js",
        ),
      },
    },
  }),
);

config.resolve.alias = longestFirst(
  config.resolve.alias as Record<string, string>,
);

export default config;
