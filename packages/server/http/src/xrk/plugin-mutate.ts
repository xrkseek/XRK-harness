/**
 * Run `xrkh` / `xrk-harness plugin add|remove` from Host (DSH market compat).
 * Spawns CLI to avoid circular deps (cli → server-host → server-http).
 *
 * Cross-platform: never `shell: true`. Windows `.cmd` shims go through
 * `ComSpec /d /s /c` with quoted argv so spaces / Unicode paths stay intact.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PluginMutateResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

/** Live CLI stream chunk for Settings TerminalBlock (Face remote-event). */
export type PluginMutateChunk = {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
};

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

async function spawnPluginCli(
  invocation: CliInvocation,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly onChunk?: (chunk: PluginMutateChunk) => void;
  },
): Promise<{ stdout: string; stderr: string }> {
  const plan = planCliInvocation(invocation, args, process.platform, options.env);
  return new Promise((resolve, reject) => {
    const child = spawn(plan.file, [...plan.args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      ...(plan.windowsVerbatimArguments
        ? { windowsVerbatimArguments: true }
        : {}),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        reject(
          Object.assign(new Error("plugin mutate timed out after 180s"), {
            stdout,
            stderr,
            code: "ETIMEDOUT",
          }),
        );
      }
    }, 180_000);

    child.stdout?.on("data", (buf: Buffer | string) => {
      const text = String(buf);
      stdout += text;
      options.onChunk?.({ stream: "stdout", text });
    });
    child.stderr?.on("data", (buf: Buffer | string) => {
      const text = String(buf);
      stderr += text;
      options.onChunk?.({ stream: "stderr", text });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(
        Object.assign(err, {
          stdout,
          stderr,
          code: (err as NodeJS.ErrnoException).code,
        }),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        Object.assign(new Error(`plugin mutate exited with code ${code ?? 1}`), {
          stdout,
          stderr,
          code: code ?? 1,
        }),
      );
    });
  });
}

export async function runPluginMutate(options: {
  readonly action: "add" | "remove";
  readonly spec: string;
  readonly pluginsDir: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Forwarded as `xrkh plugin add --registry` (npm pack mirror). */
  readonly registry?: string;
  /** Optional live stdout/stderr chunks (Settings TerminalBlock). */
  readonly onChunk?: (chunk: PluginMutateChunk) => void;
}): Promise<PluginMutateResult> {
  const spec = options.spec.trim();
  if (!spec) {
    return { ok: false, stdout: "", stderr: "", error: "missing spec" };
  }
  const sub = options.action === "add" ? "add" : "remove";
  const registry = options.registry?.trim();
  const args: string[] =
    sub === "add" && registry
      ? ["plugin", "add", "--registry", registry, spec]
      : ["plugin", sub, spec];
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
      const { stdout, stderr } = await spawnPluginCli(invocation, args, {
        cwd,
        env,
        ...(options.onChunk !== undefined ? { onChunk: options.onChunk } : {}),
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
