/**
 * Smoke: listing-first createPlugin shapes (no boot chat probe).
 * Run: `node probe-states.mjs` from this directory.
 */
import path from "node:path";
import { createPlugin, SUNFLOWER_KEY_ENV } from "./plugin.mjs";

const ok = await createPlugin();
console.log(
  "normal:",
  ok.id,
  "brands:",
  ok.llmBrands.map((b) => `${b.id}:${(b.models ?? []).length}`).join(",") ||
    "(none)",
  "sel:",
  ok.defaultSelection?.provider ?? "(none)",
  "sample:",
  (ok.llmBrands[0]?.models ?? [])
    .slice(0, 3)
    .map((m) => `${m.id}@${m.contextWindow ?? "?"}`)
    .join(","),
  "apiKeyEnv:",
  ok.llmBrands[0]?.apiKeyEnv ?? "(none)",
);
await ok.dispose();

const noBun = await createPlugin({
  sidecar: {
    bunBinary: path.join(import.meta.dirname, "vendor", "__missing_bun__"),
  },
});
console.log(
  "no-bun:",
  "brands:",
  noBun.llmBrands.length,
  "apiKeyEnv:",
  noBun.llmBrands[0]?.apiKeyEnv ?? "(none)",
  "base:",
  noBun.llmBrands[0]?.baseUrl?.slice(0, 48) ?? "(none)",
);
if (noBun.llmBrands[0]?.apiKeyEnv) {
  throw new Error("no-bun brand must not set apiKeyEnv");
}
await noBun.dispose();

const dead = await createPlugin({
  skipOpenCode: true,
  skipKilo: true,
});
console.log(
  "forced-empty:",
  dead.id,
  "brands:",
  dead.llmBrands.length,
  "hasDispose:",
  typeof dead.dispose === "function",
);
await dead.dispose();

const off = await createPlugin({ disabled: true });
console.log("disabled:", off.id, "brands:", off.llmBrands.length);
console.log("key env cleared:", process.env[SUNFLOWER_KEY_ENV] === undefined);
