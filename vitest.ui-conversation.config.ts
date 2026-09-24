import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import unit from "./vitest.config.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  unit,
  defineConfig({
    test: {
      include: [
        "packages/client/ui-conversation/tests/**/*.client.spec.ts",
        "packages/client/ui-conversation/tests/**/*.client.spec.tsx",
        "packages/client/ui-attachment/tests/**/*.client.spec.ts",
        "packages/client/ui-attachment/tests/**/*.client.spec.tsx",
      ],
      environment: "jsdom",
    },
    resolve: {
      alias: {
        ...(unit.resolve?.alias as Record<string, string> | undefined),
        "@xrkseek/client-test-runtime": path.join(
          root,
          "packages/stubs/xrk-client-test-runtime/index.js",
        ),
        "@xrkseek/xrk-attachment": path.join(
          root,
          "packages/stubs/xrk-attachment/src/index.ts",
        ),
        "@xrkseek/client-runtime/client": path.join(
          root,
          "packages/client/runtime/src/client/index.ts",
        ),
        "@xrkseek/client-ui-primitives": path.join(
          root,
          "packages/client/ui-primitives/src/index.ts",
        ),
        "@xrkseek/client-ui-slots": path.join(
          root,
          "packages/client/ui-slots/src/index.ts",
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
