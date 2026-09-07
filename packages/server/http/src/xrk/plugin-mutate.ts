/**
 * Run `xrkh` / `xrk-harness plugin add|remove` from Host (DSH market compat).
 * Spawns CLI to avoid circular deps (cli → server-host → server-http).
 *
 * Cross-platform: never `shell: true`. Windows `.cmd` shims go through
 * `ComSpec /d /s /c` with quoted argv so spaces / Unicode paths stay intact.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PluginMutateResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

export interface CliInvocation {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

/** Concrete execFile plan (no shell). */
export interface CliExecPlan {
  readonly file: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
}

function monorepoCliBin(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const binJs = path.resolve(here, "../../../../../apps/cli/dist/bin.js");
  return existsSync(binJs) ? binJs : undefined;
}

function isNodeScriptPath(bin: string): boolean {
  return /\.(cjs|mjs|js)$/i.test(bin);
}

/**
 * Quote one argv token for `cmd.exe /s /c` (spaces, quotes, metacharacters).
 * @see https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd
 */
export function quoteWindowsCmdArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"&<>|^!()%]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

/**
 * Resolve CLI invocation candidates (first usable wins at runtime).
 * Order: `XRK_HARNESS_BIN` → monorepo `apps/cli/dist/bin.js` → `xrkh` → legacy `xrk-harness`.
 */
export function listCliInvocationCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): readonly CliInvocation[] {
  const out: CliInvocation[] = [];
  const bin = env.XRK_HARNESS_BIN?.trim();
  if (bin) {
    const resolved = path.resolve(bin);
    if (isNodeScriptPath(resolved)) {
      if (existsSync(resolved)) {
        out.push({ command: process.execPath, prefixArgs: [resolved] });
      }
    } else {
      out.push({ command: resolved, prefixArgs: [] });
    }
  }
  const mono = monorepoCliBin();
  if (mono) {
    out.push({ command: process.execPath, prefixArgs: [mono] });
  }
  if (platform === "win32") {
    out.push({ command: "xrkh.cmd", prefixArgs: [] });
    out.push({ command: "xrk-harness.cmd", prefixArgs: [] });
  } else {
    out.push({ command: "xrkh", prefixArgs: [] });
    out.push({ command: "xrk-harness", prefixArgs: [] });
  }
  return out;
}

/**
 * @deprecated Prefer {@link planCliInvocation}; kept for call sites that only
 * need “will this go through cmd.exe?”. Always false for `shell` itself —
 * we never set `shell: true`.
 */
export function cliInvocationNeedsShell(
  invocation: CliInvocation,
  platform: NodeJS.Platform = process.platform,
): boolean {
  void invocation;
  void platform;
  return false;
}

/**
 * Build a shell-free execFile plan for any platform.
 * - `node` + script / unix binary / non-.cmd exe → direct argv
 * - Windows `.cmd` → `ComSpec /d /s /c` + one quoted command line
 */
export function planCliInvocation(
  invocation: CliInvocation,
  cliArgs: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): CliExecPlan {
  const directArgs = [...invocation.prefixArgs, ...cliArgs];
  const viaCmdShim =
    platform === "win32" &&
    invocation.prefixArgs.length === 0 &&
    /\.cmd$/i.test(invocation.command);

  if (!viaCmdShim) {
    return { file: invocation.command, args: directArgs };
  }

  const comspec = env.ComSpec?.trim() || "cmd.exe";
  const line = [invocation.command, ...cliArgs]
    .map(quoteWindowsCmdArg)
    .join(" ");
  return {
    file: comspec,
    args: ["/d", "/s", "/c", line],
    windowsVerbatimArguments: true,
  };
}

function looksLikeMissingCommand(err: {
  readonly message?: string;
  readonly stderr?: string;
  readonly code?: string | number;
}): boolean {
  const code = err.code;
  if (code === "ENOENT") return true;
  const text = `${err.message ?? ""}\n${err.stderr ?? ""}`.toLowerCase();
  return (
    text.includes("enoent") ||
    text.includes("not found") ||
    text.includes("is not recognized") ||
    text.includes("command not found")
  );
}

async function execPluginCli(
  invocation: CliInvocation,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
  },
): Promise<{ stdout: string; stderr: string }> {
  const plan = planCliInvocation(invocation, args, process.platform, options.env);
  const { stdout, stderr } = await execFileAsync(plan.file, [...plan.args], {
    cwd: options.cwd,
    env: options.env,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
    shell: false,
    ...(plan.windowsVerbatimArguments
      ? { windowsVerbatimArguments: true }
      : {}),
  });
  return {
    stdout: String(stdout ?? ""),
    stderr: String(stderr ?? ""),
  };
}

export async function runPluginMutate(options: {
  readonly action: "add" | "remove";
  readonly spec: string;
  readonly pluginsDir: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<PluginMutateResult> {
  const spec = options.spec.trim();
  if (!spec) {
    return { ok: false, stdout: "", stderr: "", error: "missing spec" };
  }
  const sub = options.action === "add" ? "add" : "remove";
  const args = ["plugin", sub, spec] as const;
  const env = {
    ...(options.env ?? process.env),
    XRK_PLUGINS_DIR: path.resolve(options.pluginsDir),
  };
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const candidates = listCliInvocationCandidates(env);
  let lastError = "no CLI candidate";
  let lastStdout = "";
  let lastStderr = "";

  for (let i = 0; i < candidates.length; i++) {
    const invocation = candidates[i]!;
    try {
      const { stdout, stderr } = await execPluginCli(invocation, args, {
        cwd,
        env,
      });
      return { ok: true, stdout, stderr };
    } catch (err) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        message?: string;
        code?: string | number;
      };
      lastStdout = String(e.stdout ?? "");
      lastStderr = String(e.stderr ?? "");
      lastError = e.message ?? String(err);
      // Only walk fallbacks when the binary itself is missing; real plugin
      // failures (pack/not installed) must not silently retry another CLI.
      if (!looksLikeMissingCommand(e) || i === candidates.length - 1) {
        return {
          ok: false,
          stdout: lastStdout,
          stderr: lastStderr,
          error: lastError,
        };
      }
    }
  }

  return {
    ok: false,
    stdout: lastStdout,
    stderr: lastStderr,
    error: lastError,
  };
}
