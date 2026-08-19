import { Worker } from "node:worker_threads";
import type { ToolDefinition } from "@xrkseek/core-tools";

export interface CodeRuntimeOptions {
  readonly timeoutMs?: number;
  /** Default false — no network in worker (best-effort: no fetch polyfill). */
  readonly allowNetwork?: boolean;
}

export interface CodeRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

export interface CodeRuntime {
  run(source: string, signal?: AbortSignal): Promise<CodeRunResult>;
}

/**
 * Worker-thread JS runner. No npm install, no network by default.
 * Presentation mode only — default presets do NOT register this tool.
 */
export function createWorkerCodeRuntime(
  options: CodeRuntimeOptions = {},
): CodeRuntime {
  const timeoutMs = options.timeoutMs ?? 5_000;
  return {
    async run(source, signal) {
      const workerSource = `
        const { parentPort, workerData } = require('node:worker_threads');
        const chunks = [];
        const errChunks = [];
        const origLog = console.log;
        const origErr = console.error;
        console.log = (...a) => { chunks.push(a.map(String).join(' ')); };
        console.error = (...a) => { errChunks.push(a.map(String).join(' ')); };
        try {
          const fn = new Function('console', workerData.source);
          const ret = fn({ log: console.log, error: console.error });
          Promise.resolve(ret).then((value) => {
            parentPort.postMessage({
              ok: true,
              stdout: chunks.join('\\n'),
              stderr: errChunks.join('\\n'),
              value: value === undefined ? null : String(value),
            });
          }).catch((err) => {
            parentPort.postMessage({
              ok: false,
              stdout: chunks.join('\\n'),
              stderr: errChunks.join('\\n'),
              error: String(err && err.message ? err.message : err),
            });
          });
        } catch (err) {
          parentPort.postMessage({
            ok: false,
            stdout: chunks.join('\\n'),
            stderr: errChunks.join('\\n'),
            error: String(err && err.message ? err.message : err),
          });
        }
      `;

      return new Promise<CodeRunResult>((resolve, reject) => {
        const worker = new Worker(workerSource, {
          eval: true,
          workerData: { source },
        });
        let settled = false;
        const timer = setTimeout(() => {
          void worker.terminate().then(() => {
            if (!settled) {
              settled = true;
              resolve({
                stdout: "",
                stderr: "",
                error: `timeout after ${timeoutMs}ms`,
              });
            }
          });
        }, timeoutMs);

        const onAbort = () => {
          void worker.terminate();
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        worker.on("message", (msg: {
          ok: boolean;
          stdout: string;
          stderr: string;
          error?: string;
          value?: string | null;
        }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          const stdout = [msg.stdout, msg.value].filter(Boolean).join("\n");
          resolve({
            stdout,
            stderr: msg.stderr,
            ...(msg.ok ? {} : { error: msg.error ?? "code failed" }),
          });
        });
        worker.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
    },
  };
}

/** Sole Code Mode wire: `run_code`. Sub-calls must re-enter the tool pipeline. */
export function createRunCodeTool(runtime: CodeRuntime): ToolDefinition {
  return {
    name: "run_code",
    description:
      "Run a short JavaScript snippet in an isolated worker (no network). Experimental.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "JavaScript source" },
      },
      required: ["source"],
    },
    async execute(args, signal) {
      const source = String((args as { source?: string }).source ?? "");
      try {
        const out = await runtime.run(source, signal);
        if (out.error) {
          return {
            content: `error: ${out.error}\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}`,
            isError: true,
          };
        }
        return {
          content: [out.stdout, out.stderr ? `stderr:\n${out.stderr}` : ""]
            .filter(Boolean)
            .join("\n"),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: message, isError: true };
      }
    },
  };
}
