import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Map workspace packages to TypeScript sources for Vitest. */
function pkg(name: string, rel: string): [string, string] {
  return [`@xrkseek/${name}`, path.join(root, rel)];
}

export default defineConfig({
  resolve: {
    alias: Object.fromEntries([
      pkg("kernel", "packages/kernel/src/index.ts"),
      pkg("compose", "packages/compose/src/index.ts"),
      pkg("protocol", "packages/protocol/src/index.ts"),
      pkg("core-session", "packages/core/session/src/index.ts"),
      pkg("core-tools", "packages/core/tools/src/index.ts"),
      pkg("core-system-prompt", "packages/core/system-prompt/src/index.ts"),
      pkg("core-agent-loop", "packages/core/agent-loop/src/index.ts"),
      pkg("core-agent", "packages/core/agent/src/index.ts"),
      pkg("llm", "packages/llm/llm/src/index.ts"),
      pkg("llm-replay", "packages/llm/replay/src/index.ts"),
      pkg("llm-openai-compatible", "packages/llm/openai-compatible/src/index.ts"),
      pkg("llm-openai-responses", "packages/llm/openai-responses/src/index.ts"),
      pkg("llm-anthropic", "packages/llm/anthropic/src/index.ts"),
      pkg("llm-gemini", "packages/llm/gemini/src/index.ts"),
      pkg("llm-deepseek", "packages/llm/deepseek/src/index.ts"),
      pkg("llm-registry", "packages/llm/registry/src/index.ts"),
      pkg("exec-fs", "packages/exec/fs/src/index.ts"),
      pkg("exec-web", "packages/exec/web/src/index.ts"),
      pkg("exec-lsp", "packages/exec/lsp/src/index.ts"),
      pkg("exec-pty", "packages/exec/pty/src/index.ts"),
      pkg("exec-subprocess", "packages/exec/subprocess/src/index.ts"),
      pkg("exec-shell", "packages/exec/shell/src/index.ts"),
      pkg("exec-sandbox", "packages/exec/sandbox/src/index.ts"),
      pkg("workspace", "packages/workspace/src/index.ts"),
      pkg("policy", "packages/policy/src/index.ts"),
      pkg("code-runtime", "packages/code-runtime/src/index.ts"),
      pkg("mcp", "packages/mcp/src/index.ts"),
      pkg("attachment", "packages/attachment/src/index.ts"),
      pkg("testkit", "packages/testkit/src/index.ts"),
      pkg("server-config", "packages/server/config/src/index.ts"),
      pkg("server-loader", "packages/server/loader/src/index.ts"),
      pkg("server-http", "packages/server/http/src/index.ts"),
      pkg("server-face", "packages/server/face/src/index.ts"),
      pkg("server-host", "packages/server/host/src/index.ts"),
      pkg("session-projection", "packages/session/session-projection/src/index.ts"),
      pkg("web-runtime", "packages/web-runtime/src/index.ts"),
      pkg("harness", "packages/sdk/src/index.ts"),
      pkg("preset-minimal", "presets/minimal/preset.ts"),
      pkg("preset-harness", "presets/harness/preset.ts"),
      pkg("preset-server", "presets/server/preset.ts"),
      ["@xrkseek/xrk-file-reference/types", path.join(root, "packages/context/file-reference/src/types.ts")],
      ["@xrkseek/xrk-file-reference/grammar", path.join(root, "packages/context/file-reference/src/grammar.ts")],
      ["@xrkseek/xrk-file-reference-local/search", path.join(root, "packages/context/file-reference-local/src/search.ts")],
      ["@xrkseek/xrk-session-reference/config", path.join(root, "packages/context/session-reference/src/config.ts")],
      ["@xrkseek/xrk-session-reference/uri", path.join(root, "packages/context/session-reference/src/uri.ts")],
      ["@xrkseek/xrk-session-reference/types", path.join(root, "packages/context/session-reference/src/types.ts")],
      ["@xrkseek/xrk-session/types", path.join(root, "packages/stubs/xrk-session/src/types.ts")],
    ]),
  },
  test: {
    include: [
      "packages/**/tests/**/*.test.ts",
      "presets/**/tests/**/*.test.ts",
      "apps/**/tests/**/*.test.ts",
    ],
    globals: false,
    pool: "forks",
  },
});
