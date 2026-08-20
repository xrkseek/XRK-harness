import { loadHostConfig, defaultSessionsDir } from "@xrkseek/server-config";
import { createHostManager, type AgentFactory } from "@xrkseek/server-host";
import {
  createServerAgentFactory,
  createServerComposition,
} from "@xrkseek/preset-server";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { resolveLlmFromEnv } from "@xrkseek/llm-registry";
import { createPolicyEngineFromFile, type PolicyEngine } from "@xrkseek/policy";
import { spawn } from "node:child_process";
import path from "node:path";
import { assertSafeHost, type ParsedArgs } from "../parse-args.js";
import {
  ensureProductWebDist,
  repoRoot,
} from "../product-paths.js";
import { createCliLogger, resolveLogLevel, type CliLogger } from "../log.js";
import { forceFreePort } from "../port.js";

function openProductUrl(url: string, log: CliLogger): void {
  const platform = process.platform;
  const child =
    platform === "win32"
      ? spawn("cmd.exe", ["/c", "start", "", url], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        })
      : spawn(platform === "darwin" ? "open" : "xdg-open", [url], {
          detached: true,
          stdio: "ignore",
        });
  child.once("error", (err) => {
    log.warn(`could not open browser: ${err.message}`);
  });
  child.unref();
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
  return async ({
    sessionId,
    store,
    workspaceRoot: root,
    plugins,
    resolveImage,
    resolveLlm,
  }) => {
    const fromFace = resolveLlm?.(sessionId);
    const fromEnv = fromFace ? undefined : resolveLlmFromEnv(process.env);
    const composition = createMinimalComposition({
      workspaceRoot: root || workspaceRoot,
      sessionStore: store,
      sessionId,
      assemble: true,
      plugins,
      ...(fromFace ? { llm: fromFace } : fromEnv ? { llm: fromEnv.adapter } : {}),
      ...(policy ? { policy } : {}),
      ...(resolveImage ? { resolveImage } : {}),
    });
    return composition.createAgent();
  };
}

export async function runServe(args: ParsedArgs): Promise<number> {
  const log = createCliLogger(
    resolveLogLevel({ verbose: args.verbose, quiet: args.quiet }),
  );

  const patch: Record<string, unknown> = {
    ...args.patch,
    workspaceRoot: args.workspace,
    preset: args.preset,
  };
  if (args.host) patch.host = args.host;
  if (args.port !== undefined) patch.port = args.port;

  const config = loadHostConfig({ patch });
  assertSafeHost(config.runtime.host);

  if (args.force && config.runtime.port > 0) {
    await forceFreePort(config.runtime.port, log);
  }

  const preset =
    args.preset === "minimal" ||
    args.preset === "harness" ||
    args.preset === "server"
      ? args.preset
      : config.runtime.preset;

  const policy = config.runtime.policyFile
    ? await createPolicyEngineFromFile(config.runtime.policyFile)
    : undefined;

  let webDist: string;
  try {
    webDist = await ensureProductWebDist(config.runtime.webDist);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    return 1;
  }
  const sessionsDir = args.persist
    ? (config.runtime.sessionsDir?.trim() || defaultSessionsDir())
    : undefined;

  const manager = createHostManager();
  const factory = factoryForPreset(
    preset,
    config.runtime.workspaceRoot,
    policy,
  );
  const runtime = {
    ...config.runtime,
    preset,
    webDist,
  } as typeof config.runtime & { sessionsDir?: string };
  if (sessionsDir) runtime.sessionsDir = sessionsDir;
  else delete runtime.sessionsDir;

  const instance = await manager.spawn(
    {
      ...config,
      runtime,
    },
    factory,
    { logger: log },
  );

  const health = instance.health();
  const port = health.port ?? config.runtime.port;
  const origin = `http://${config.runtime.host}:${port}`;
  log.info(`xrk-harness serve  ${origin}/`);
  const uiRel = path.relative(repoRoot(), webDist) || webDist;
  log.info(`  workspace=${config.runtime.workspaceRoot}`);
  log.info(
    `  preset=${preset}  ui=${uiRel}  sessions=${sessionsDir ?? "memory"}`,
  );
  log.info(
    `  mcpAllow=${config.runtime.mcpAllowConnect ? "on" : "off"}  log=${log.level}`,
  );
  if (config.credentials.apiKey) {
    log.info("  apiKey=set");
  }
  if (policy) log.info("  policy=on");
  log.info("  tip: Ctrl+C stop · `xrk-harness restart` / `web --force` free port");

  if (args.open) {
    openProductUrl(`${origin}/`, log);
  }

  const shutdown = async () => {
    log.info("shutting down...");
    await manager.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await new Promise(() => {});
  return 0;
}

/** Dump server-preset config for `dump-config --preset server`. */
export function dumpServeConfig(args: ParsedArgs): Record<string, unknown> {
  return createServerComposition({
    workspaceRoot: args.workspace,
  }).dumpConfig(args.patch);
}
