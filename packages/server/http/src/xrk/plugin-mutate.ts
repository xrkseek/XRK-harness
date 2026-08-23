/**
 * Run `xrk-harness plugin add|remove` from Host (DSH market compat).
 * Spawns CLI to avoid circular deps (cli → server-host → server-http).
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

function resolveCliInvocation(): { command: string; prefixArgs: string[] } {
  const bin = process.env.XRK_HARNESS_BIN?.trim();
  if (bin) {
    if (bin.endsWith(".js") && existsSync(bin)) {
      return { command: process.execPath, prefixArgs: [bin] };
    }
    return { command: bin, prefixArgs: [] };
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const binJs = path.resolve(here, "../../../../../apps/cli/dist/bin.js");
  if (existsSync(binJs)) {
    return { command: process.execPath, prefixArgs: [binJs] };
  }
  return { command: "xrk-harness", prefixArgs: [] };
}

export async function runPluginMutate(options: {
  readonly action: "add" | "remove";
  readonly spec: string;
  readonly pluginsDir: string;
  readonly cwd?: string;
}): Promise<PluginMutateResult> {
  const spec = options.spec.trim();
  if (!spec) {
    return { ok: false, stdout: "", stderr: "", error: "missing spec" };
  }
  const { command, prefixArgs } = resolveCliInvocation();
  const sub = options.action === "add" ? "add" : "remove";
  const args = [...prefixArgs, "plugin", sub, spec];
  const env = { ...process.env, XRK_PLUGINS_DIR: options.pluginsDir };
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      ok: true,
      stdout: String(stdout ?? ""),
      stderr: String(stderr ?? ""),
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      error: e.message ?? String(err),
    };
  }
}
