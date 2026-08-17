import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "@xrkseek/server-host";
import {
  createServerAgentFactory,
  createServerComposition,
} from "@xrkseek/preset-server";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { resolveLlmFromEnv } from "@xrkseek/llm-registry";
import { createPolicyEngineFromFile, type PolicyEngine } from "@xrkseek/policy";
import { access } from "node:fs/promises";
import path from "node:path";
import type { ParsedArgs } from "../parse-args.js";
import type { AgentFactory } from "@xrkseek/server-host";

/** Prefer env/patch; else auto-pick captured DSH UI, then `apps/web/dist`. */
async function resolveWebDist(
  configured: string | undefined,
  workspaceRoot: string,
): Promise<string | undefined> {
  if (configured?.trim()) return path.resolve(configured.trim());
  const candidates = [
    path.resolve(workspaceRoot, "vendor", "dsh-web-static"),
    path.resolve(process.cwd(), "vendor", "dsh-web-static"),
    path.resolve(workspaceRoot, "apps", "web", "dist"),
    path.resolve(process.cwd(), "apps", "web", "dist"),
  ];
  for (const dir of candidates) {
    try {
      await access(path.join(dir, "index.html"));
      return dir;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function factoryForPreset(
  preset: string,
  workspaceRoot: string,
  policy?: PolicyEngine,
): AgentFactory {
  if (preset === "server" || preset === "harness") {
    return createServerAgentFactory({
      workspaceRoot,
      ...(policy ? { policy } : {}),
    });
  }
  // minimal — prefer Registry env LLM when XRK_LLM_PRESET is set
  return async ({ sessionId, store, workspaceRoot: root, plugins }) => {
    const fromEnv = resolveLlmFromEnv(process.env);
    const composition = createMinimalComposition({
      workspaceRoot: root || workspaceRoot,
      sessionStore: store,
      sessionId,
      assemble: true,
      plugins,
      ...(fromEnv ? { llm: fromEnv.adapter } : {}),
      ...(policy ? { policy } : {}),
    });
    return composition.createAgent();
  };
}

export async function runServe(args: ParsedArgs): Promise<number> {
  const config = loadHostConfig({
    patch: {
      ...args.patch,
      workspaceRoot: args.workspace,
      preset: args.preset,
    },
  });

  // allow --preset to override
  const preset =
    args.preset === "minimal" ||
    args.preset === "harness" ||
    args.preset === "server"
      ? args.preset
      : config.runtime.preset;

  const policy = config.runtime.policyFile
    ? await createPolicyEngineFromFile(config.runtime.policyFile)
    : undefined;

  const webDist = await resolveWebDist(
    config.runtime.webDist,
    config.runtime.workspaceRoot,
  );

  const manager = createHostManager();
  const factory = factoryForPreset(
    preset,
    config.runtime.workspaceRoot,
    policy,
  );
  const instance = await manager.spawn(
    {
      ...config,
      runtime: {
        ...config.runtime,
        preset,
        ...(webDist ? { webDist } : {}),
      },
    },
    factory,
  );

  const health = instance.health();
  process.stdout.write(
    `xrk-harness serve listening on http://${config.runtime.host}:${health.port}\n`,
  );
  process.stdout.write(
    `preset=${preset} apiKey=${config.credentials.apiKey ? "set" : "off (dev)"}${policy ? " policy=on" : ""}${webDist ? ` web=${webDist}` : " web=api-landing"}\n`,
  );

  const shutdown = async () => {
    process.stdout.write("shutting down...\n");
    await manager.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  // keep alive
  await new Promise(() => {});
  return 0;
}

/** Dump server-preset config for `dump-config --preset server`. */
export function dumpServeConfig(args: ParsedArgs): Record<string, unknown> {
  return createServerComposition({
    workspaceRoot: args.workspace,
  }).dumpConfig(args.patch);
}
