/**
 * Shell-free spawn plan for `npm view` / light registry probes.
 * Windows: never bare `spawn("npm.cmd", …, { shell: false })` — that is EINVAL.
 * Prefer execPath-adjacent `npm-cli.js` (Desktop bundled Node); else
 * `ComSpec /d /s /c` for `.cmd` (same posture as plugin pack / mutate).
 *
 * Shared by Face plugin inventory probes, GenUI npm bridge, and mobile funnel
 * so Desktop / CLI Host / Mobile guest Host stay on one Windows spawn posture.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { quoteWindowsCmdArg } from "./plugin-mutate.js";

export type NpmViewSpawnPlan = {
  readonly file: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
};

/** Optional Settings install-row net (same registry/proxy as `plugin add`). */
export type NpmViewNetOptions = {
  readonly registry?: string;
  readonly proxy?: string;
};

/** Face / Settings `--registry` / `--proxy` must be plain http(s) URLs. */
export function isNpmViewHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Drop empty / non-http(s) registry & proxy before they reach npm argv.
 * Prevents CLI-option shaped strings from being appended as `--registry`.
 */
export function normalizeNpmViewNet(
  net?: NpmViewNetOptions,
): NpmViewNetOptions {
  const registry = net?.registry?.trim() ?? "";
  const proxy = net?.proxy?.trim() ?? "";
  return {
    ...(registry && isNpmViewHttpUrl(registry) ? { registry } : {}),
    ...(proxy && isNpmViewHttpUrl(proxy) ? { proxy } : {}),
  };
}

/** Build `npm view <name> version` argv, optionally scoped to Settings net. */
export function buildNpmViewVersionArgs(
  packageName: string,
  net?: NpmViewNetOptions,
): string[] {
  const args = ["view", packageName, "version"];
  const safe = normalizeNpmViewNet(net);
  if (safe.registry) args.push("--registry", safe.registry);
  if (safe.proxy) args.push("--proxy", safe.proxy);
  return args;
}

/**
 * Build a shell-free exec plan for npm argv (e.g. `view name version`).
 */
export function planNpmViewSpawn(
  npmArgs: readonly string[],
  options: {
    readonly execPath?: string;
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): NpmViewSpawnPlan {
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const dir = path.dirname(execPath);
  const cliCandidates = [
    path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const cli of cliCandidates) {
    if (existsSync(cli)) {
      return { file: execPath, args: [cli, ...npmArgs] };
    }
  }
  if (platform === "win32") {
    const adjacent = path.join(dir, "npm.cmd");
    const npmFile = existsSync(adjacent) ? adjacent : "npm.cmd";
    const comspec = env.ComSpec?.trim() || "cmd.exe";
    const line = [npmFile, ...npmArgs].map(quoteWindowsCmdArg).join(" ");
    return {
      file: comspec,
      args: ["/d", "/s", "/c", line],
      windowsVerbatimArguments: true,
    };
  }
  const adjacent = path.join(dir, "npm");
  return {
    file: existsSync(adjacent) ? adjacent : "npm",
    args: [...npmArgs],
  };
}
