import { spawn } from "node:child_process";
import type { CronJob, CronRunResult, CronScriptRunner } from "./types.js";
import { CronError } from "./types.js";

export interface CreateScriptRunnerOptions {
  readonly defaultCwd?: string;
  readonly shell?: boolean;
  readonly maxOutputChars?: number;
}

/** Default script runner — spawn via shell, capture stdout/stderr. */
export function createDefaultScriptRunner(
  options: CreateScriptRunnerOptions = {},
): CronScriptRunner {
  const maxChars = options.maxOutputChars ?? 50_000;
  return async (job, signal): Promise<CronRunResult> => {
    if (job.run.kind !== "script") {
      throw new CronError("not a script job", "CRON_ARGS");
    }
    const command = job.run.command;
    const cwd = job.run.cwd?.trim() || options.defaultCwd || process.cwd();
    return await new Promise((resolve) => {
      const child = spawn(command, {
        cwd,
        shell: options.shell !== false,
        windowsHide: true,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      const onAbort = () => {
        child.kill();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > maxChars) stdout = stdout.slice(0, maxChars);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > maxChars) stderr = stderr.slice(0, maxChars);
      });
      child.on("error", (err) => {
        signal?.removeEventListener("abort", onAbort);
        resolve({
          ok: false,
          output: "",
          error: err.message,
        });
      });
      child.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
        const output = [stdout, stderr].filter(Boolean).join("\n").trim();
        resolve({
          ok: code === 0,
          output,
          ...(code !== 0
            ? { error: `exit ${code ?? "null"}` }
            : {}),
        });
      });
    });
  };
}

export function formatCronOutput(job: CronJob, result: CronRunResult): string {
  const header = `[cron ${job.id}${job.name ? ` ${job.name}` : ""}] ${result.ok ? "ok" : "error"}`;
  const err = result.error ? `\nerror: ${result.error}` : "";
  return `${header}${err}\n${result.output}`.trim();
}
