import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * M0 lint gate: type-aware recommended + no-explicit-any + no-floating-promises.
 * Scope matches root tsconfig.json references (kernel / server / CLI).
 * Product shell (packages/client) and DSH stubs are typed by their own builds — excluded here.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/tests/**",
      "**/*.client.spec.ts",
      "**/*.client.spec.tsx",
      "extensions/**",
      "scripts/**",
      "vitest.config.ts",
      "vitest.kernel.config.ts",
      "vitest.web.config.ts",
      "**/vite.config.ts",
      "**/*.mjs",
      "**/*.cjs",
      // Not in root tsc -b; huge fixture/stub trees make projectService hang on Windows.
      "packages/client/**",
      "packages/stubs/**",
      "packages/cordis/**",
      "packages/cordis-loader/**",
      "packages/schemastery/**",
      "apps/web/**",
      "apps/console/**",
      "apps/cli/product-web/**",
      "apps/cli/dist/**",
      "**/*.js",
      "**/*.jsx",
      ".eslintcache",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        allowDefaultProject: ["*.ts"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // Gradual: prefer unknown; keep noise down for M0.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
);
