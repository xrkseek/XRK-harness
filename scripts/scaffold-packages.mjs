import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/** @type {{ path: string; name: string; rel: string; bin?: boolean }[]} */
const packages = [
  { path: "packages/kernel", name: "@xrkseek/kernel", rel: "../.." },
  { path: "packages/protocol", name: "@xrkseek/protocol", rel: "../.." },
  { path: "packages/core/agent", name: "@xrkseek/core-agent", rel: "../../.." },
  { path: "packages/core/agent-loop", name: "@xrkseek/core-agent-loop", rel: "../../.." },
  { path: "packages/core/tools", name: "@xrkseek/core-tools", rel: "../../.." },
  { path: "packages/core/session", name: "@xrkseek/core-session", rel: "../../.." },
  { path: "packages/core/system-prompt", name: "@xrkseek/core-system-prompt", rel: "../../.." },
  { path: "packages/llm/llm", name: "@xrkseek/llm", rel: "../../.." },
  { path: "packages/llm/openai-compatible", name: "@xrkseek/llm-openai-compatible", rel: "../../.." },
  { path: "packages/llm/deepseek", name: "@xrkseek/llm-deepseek", rel: "../../.." },
  { path: "packages/llm/replay", name: "@xrkseek/llm-replay", rel: "../../.." },
  { path: "packages/mcp", name: "@xrkseek/mcp", rel: "../.." },
  { path: "packages/exec/fs", name: "@xrkseek/exec-fs", rel: "../../.." },
  { path: "packages/exec/subprocess", name: "@xrkseek/exec-subprocess", rel: "../../.." },
  { path: "packages/exec/shell", name: "@xrkseek/exec-shell", rel: "../../.." },
  { path: "packages/exec/sandbox", name: "@xrkseek/exec-sandbox", rel: "../../.." },
  { path: "packages/workspace", name: "@xrkseek/workspace", rel: "../.." },
  { path: "packages/policy", name: "@xrkseek/policy", rel: "../.." },
  { path: "packages/server/http", name: "@xrkseek/server-http", rel: "../../.." },
  { path: "packages/server/loader", name: "@xrkseek/server-loader", rel: "../../.." },
  { path: "packages/server/host", name: "@xrkseek/server-host", rel: "../../.." },
  { path: "packages/server/config", name: "@xrkseek/server-config", rel: "../../.." },
  { path: "packages/sdk", name: "@xrkseek/harness", rel: "../.." },
  { path: "packages/testkit", name: "@xrkseek/testkit", rel: "../.." },
  { path: "apps/cli", name: "@xrkseek/harness-cli", rel: "../..", bin: true },
];

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

for (const p of packages) {
  const dir = path.join(root, p.path);
  const pkg = {
    name: p.name,
    version: "0.0.0",
    private: true,
    type: "module",
    exports: {
      ".": {
        types: "./src/index.ts",
        default: "./src/index.ts",
      },
    },
    files: ["dist", "README.md"],
  };
  if (p.bin) {
    pkg.bin = { "xrk-harness": "./src/bin.ts" };
  }
  write(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  write(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: `${p.rel}/tsconfig.base.json`,
        compilerOptions: {
          composite: true,
          rootDir: "src",
          outDir: "dist",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ) + "\n",
  );
  write(
    path.join(dir, "README.md"),
    `# ${p.name}\n\nScaffold placeholder. See repo \`AGENTS.md\`.\n\n**Status:** empty shell (S3)\n`,
  );
  write(
    path.join(dir, "src/index.ts"),
    `/** ${p.name} — scaffold; implement per WBS. */\nexport {};\n`,
  );
  write(path.join(dir, "tests/.gitkeep"), "");

  if (p.bin) {
    write(
      path.join(dir, "src/bin.ts"),
      `#!/usr/bin/env node\nconsole.error("xrk-harness: not implemented yet (wire in S8)");\nprocess.exit(1);\n`,
    );
    for (const cmd of ["run", "doctor", "dump-config", "serve"]) {
      const fn = cmd.replace(/-/g, "_") + "Command";
      write(
        path.join(dir, `src/commands/${cmd}.ts`),
        `export function ${fn}(): never {\n  throw new Error("${cmd}: not implemented");\n}\n`,
      );
    }
  }
}

for (const preset of ["minimal", "harness", "server"]) {
  const dir = path.join(root, "presets", preset);
  write(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: `@xrkseek/preset-${preset}`,
        version: "0.0.0",
        private: true,
        type: "module",
        exports: { ".": "./preset.ts" },
      },
      null,
      2,
    ) + "\n",
  );
  write(
    path.join(dir, "preset.ts"),
    `/** Preset: ${preset} — composition only, no business logic. */\nexport const presetId = "${preset}" as const;\n\nexport const preset = {\n  id: presetId,\n  description: "TODO: wire composition in M0/M1",\n  plugins: [] as string[],\n};\n`,
  );
  write(
    path.join(dir, "README.md"),
    `# presets/${preset}\n\nComposition preset. No business logic.\n`,
  );
}

const docs = [
  "architecture",
  "seams",
  "session",
  "tool-pipeline",
  "host-preset",
  "profiles",
  "migrate-from-agt",
  "references",
  "security-checklist",
  "testing",
  "publishing",
];
for (const d of docs) {
  write(path.join(root, "docs", `${d}.md`), `# ${d}\n\nTODO: fill from canvas specs.\n`);
}
write(
  path.join(root, "docs/adr/README.md"),
  `# ADR\n\nArchitecture Decision Records.\n\n- ADR-0001: TypeScript-only host (no Go gateway)\n- ADR-0002: Do not embed third-party agent runtime source trees\n`,
);

write(
  path.join(root, "BENCHMARK.md"),
  `# BENCHMARK\n\nOfficial scores use \`presets/minimal\` so harness scaffolding does not inflate model ability.\n`,
);
write(
  path.join(root, "CONTRIBUTING.md"),
  `# Contributing\n\n1. Read \`AGENTS.md\`\n2. Follow atomic WBS S1–S8\n3. \`pnpm check\` must pass\n4. Do not add Go host trees\n`,
);
write(
  path.join(root, "apps/console/package.json"),
  JSON.stringify({ name: "@xrkseek/harness-console", version: "0.0.0", private: true }, null, 2) +
    "\n",
);
write(
  path.join(root, "apps/console/README.md"),
  `# @xrkseek/harness-console\n\nFace verifier console. Product shell: apps/web + packages/client.\n`,
);
write(
  path.join(root, "examples/hello-agent/README.md"),
  `# hello-agent\n\nMinimal example. Wire after \`xrk-harness run --preset minimal\` works (S8).\n`,
);
write(
  path.join(root, "examples/sdk-quickstart/README.md"),
  `# sdk-quickstart\n\nM2 placeholder.\n`,
);
write(
  path.join(root, "extensions/example-tools/README.md"),
  `# example-tools\n\nFirst-class extension sample (M1).\n`,
);
write(
  path.join(root, "extensions/example-tools/src/index.ts"),
  `export {};\n`,
);
write(
  path.join(root, "extensions/channels-stdin/README.md"),
  `# channels-stdin\n\nStdin channel extension.\n`,
);
write(
  path.join(root, "extensions/channels-stdin/src/index.ts"),
  `export {};\n`,
);
write(
  path.join(root, "extensions/channels-onebot/README.md"),
  `# channels-onebot\n\nM3 OneBot channel — not in core.\n`,
);
write(
  path.join(root, "templates/office-agent/README.md"),
  `# office-agent\n\nTemplate migrated from XRK-AGT \`agents/\` (M2).\n`,
);

// kernel suggested modules as empty stubs
for (const f of ["context", "plugin", "registry", "events", "patch"]) {
  write(
    path.join(root, "packages/kernel/src", `${f}.ts`),
    `/** @xrkseek/kernel/${f} — stub */\nexport {};\n`,
  );
}
for (const f of ["messages", "tools", "session-events"]) {
  write(
    path.join(root, "packages/protocol/src", `${f}.ts`),
    `/** @xrkseek/protocol/${f} — stub */\nexport {};\n`,
  );
}

console.log(`OK: ${packages.length} packages + presets/docs/stubs`);
