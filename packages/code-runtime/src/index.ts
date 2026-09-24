import { Worker } from "node:worker_threads";
import type {
  ToolDefinition,
  ToolPipeline,
  ToolRegistry,
} from "@xrkseek/core-tools";
import { runTool } from "@xrkseek/core-tools";

/** Largest delay Node schedules without clamping it to one millisecond. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Default elapsed deadline for one `run_code` call (aligned with PTC node defaults). */
export const DEFAULT_CODE_TIMEOUT_MS = 120_000;
/** Upper bound accepted for per-call `timeoutMs`. */
export const DEFAULT_CODE_MAX_TIMEOUT_MS = 600_000;
/** Combined stdout/stderr/value UTF-8 byte cap. */
export const DEFAULT_CODE_MAX_OUTPUT_BYTES = 67_108_864;
/** V8 old-generation heap limit in MiB for the worker. */
export const DEFAULT_CODE_MAX_OLD_GENERATION_SIZE_MB = 512;

export interface CodeRuntimeOptions {
  /** Default elapsed deadline when the call omits `timeoutMs`. */
  readonly timeoutMs?: number;
  /** Maximum numeric elapsed budget accepted by resolve. */
  readonly maxTimeoutMs?: number;
  /** Combined stdout/stderr/value UTF-8 byte cap. */
  readonly maxOutputBytes?: number;
  /** V8 old-generation heap limit in MiB; native allocations are excluded. */
  readonly maxOldGenerationSizeMb?: number;
  /** Default false — no network in worker (best-effort: no fetch polyfill). */
  readonly allowNetwork?: boolean;
}

export interface CodeRunOptions {
  /** Optional per-call budget; clamped to `[1, maxTimeoutMs]` against the runtime default. */
  readonly timeoutMs?: number;
}

export interface CodeRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
  /** True when stdout/stderr were truncated to `maxOutputBytes`. */
  readonly truncated?: boolean;
}

export interface CodeRuntime {
  readonly timeout: { readonly defaultMs: number; readonly maxMs: number };
  readonly maxOutputBytes: number;
  run(
    source: string,
    signal?: AbortSignal,
    opts?: CodeRunOptions,
  ): Promise<CodeRunResult>;
}

/**
 * Validate a caller's optional timeout hint, use the backend default, then cap
 * it. Zero is not a disable-timeout sentinel.
 */
export function clampCodeTimeout(
  requested: number | undefined,
  def: number,
  max: number,
  name = "timeoutMs",
): number {
  if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return Math.min(requested ?? def, max);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`code-runtime: ${name} must be positive and finite`);
  }
}

function takeUtf8Prefix(input: string, maximumBytes: number): string {
  let bytes = 0;
  let content = "";
  for (const char of input) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maximumBytes) break;
    content += char;
    bytes += size;
  }
  return content;
}

/** Cap a single stream; reserve room for a truncation marker when needed. */
export function boundCodeOutput(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (maxBytes < 4) {
    throw new Error("code-runtime: maxOutputBytes must be an integer of at least 4");
  }
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }
  const marker = "\n...[truncated]";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  return { text: `${takeUtf8Prefix(text, budget)}${marker}`, truncated: true };
}

function resolveConfig(options: CodeRuntimeOptions): {
  timeoutMs: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  maxOldGenerationSizeMb: number;
} {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODE_TIMEOUT_MS;
  const maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_CODE_MAX_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_CODE_MAX_OUTPUT_BYTES;
  const maxOldGenerationSizeMb =
    options.maxOldGenerationSizeMb ?? DEFAULT_CODE_MAX_OLD_GENERATION_SIZE_MB;

  for (const [key, value] of Object.entries({
    timeoutMs,
    maxTimeoutMs,
    maxOutputBytes,
    maxOldGenerationSizeMb,
  })) {
    assertPositiveFinite(value, key);
  }
  if (timeoutMs > MAX_TIMER_DELAY_MS || maxTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error("code-runtime: timeout exceeds the supported timer range");
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 4) {
    throw new Error("code-runtime: maxOutputBytes must be an integer of at least 4");
  }
  if (!Number.isSafeInteger(maxOldGenerationSizeMb)) {
    throw new Error("code-runtime: maxOldGenerationSizeMb must be an integer");
  }
  return {
    timeoutMs: Math.min(timeoutMs, maxTimeoutMs),
    maxTimeoutMs,
    maxOutputBytes,
    maxOldGenerationSizeMb,
  };
}

/**
 * Worker-thread JS runner. No npm install, no network by default.
 * Presentation mode only — default presets do NOT register this tool.
 * Nested `tools.*` calls use {@link createRunCodeTool} with a tool bridge
 * (in-process AsyncFunction); the worker path remains snippet-only.
 */
export function createWorkerCodeRuntime(
  options: CodeRuntimeOptions = {},
): CodeRuntime {
  const config = resolveConfig(options);
  return {
    timeout: { defaultMs: config.timeoutMs, maxMs: config.maxTimeoutMs },
    maxOutputBytes: config.maxOutputBytes,
    async run(source, signal, opts) {
      const timeoutMs = clampCodeTimeout(
        opts?.timeoutMs,
        config.timeoutMs,
        config.maxTimeoutMs,
      );
      const workerSource = `
        const { parentPort, workerData } = require('node:worker_threads');
        const chunks = [];
        const errChunks = [];
        const maxBytes = workerData.maxOutputBytes;
        const trim = (s) => {
          const buf = Buffer.from(String(s), 'utf8');
          if (buf.byteLength <= maxBytes) return String(s);
          const marker = '\\n...[truncated]';
          const keep = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
          return buf.subarray(0, keep).toString('utf8') + marker;
        };
        console.log = (...a) => { chunks.push(a.map(String).join(' ')); };
        console.error = (...a) => { errChunks.push(a.map(String).join(' ')); };
        try {
          const fn = new Function('console', workerData.source);
          const ret = fn({ log: console.log, error: console.error });
          Promise.resolve(ret).then((value) => {
            parentPort.postMessage({
              ok: true,
              stdout: trim(chunks.join('\\n')),
              stderr: trim(errChunks.join('\\n')),
              value: value === undefined ? null : trim(String(value)),
            });
          }).catch((err) => {
            parentPort.postMessage({
              ok: false,
              stdout: trim(chunks.join('\\n')),
              stderr: trim(errChunks.join('\\n')),
              error: String(err && err.message ? err.message : err),
            });
          });
        } catch (err) {
          parentPort.postMessage({
            ok: false,
            stdout: trim(chunks.join('\\n')),
            stderr: trim(errChunks.join('\\n')),
            error: String(err && err.message ? err.message : err),
          });
        }
      `;

      return new Promise<CodeRunResult>((resolve, reject) => {
        const worker = new Worker(workerSource, {
          eval: true,
          workerData: {
            source,
            maxOutputBytes: config.maxOutputBytes,
          },
          resourceLimits: {
            maxOldGenerationSizeMb: config.maxOldGenerationSizeMb,
          },
        });
        let settled = false;
        /** Host-initiated stop (timeout/abort); ignore the resulting exit code. */
        let stopping = false;
        const finish = (result: CodeRunResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const timer = setTimeout(() => {
          stopping = true;
          void worker.terminate().then(() => {
            finish({
              stdout: "",
              stderr: "",
              error: `timeout after ${timeoutMs}ms`,
            });
          });
        }, timeoutMs);

        const onAbort = () => {
          stopping = true;
          void worker.terminate().then(() => {
            finish({
              stdout: "",
              stderr: "",
              error: "aborted",
            });
          });
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        worker.on("message", (msg: {
          ok: boolean;
          stdout: string;
          stderr: string;
          error?: string;
          value?: string | null;
        }) => {
          const rawStdout = [msg.stdout, msg.value].filter(Boolean).join("\n");
          const stdoutBound = boundCodeOutput(rawStdout, config.maxOutputBytes);
          const stderrBound = boundCodeOutput(msg.stderr, config.maxOutputBytes);
          finish({
            stdout: stdoutBound.text,
            stderr: stderrBound.text,
            ...(msg.ok ? {} : { error: msg.error ?? "code failed" }),
            ...(stdoutBound.truncated || stderrBound.truncated
              ? { truncated: true }
              : {}),
          });
        });
        worker.on("error", (err) => {
          if (settled || stopping) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          const message = err instanceof Error ? err.message : String(err);
          // Heap / resourceLimit failures surface as worker errors.
          if (/heap|memory|resource/i.test(message)) {
            resolve({
              stdout: "",
              stderr: "",
              error: `worker resource limit: ${message}`,
            });
            return;
          }
          reject(err instanceof Error ? err : new Error(String(err)));
        });
        worker.on("exit", (code) => {
          if (settled || stopping) return;
          if (code !== 0) {
            finish({
              stdout: "",
              stderr: "",
              error: `worker exited with code ${code}`,
            });
          }
        });
      });
    },
  };
}

/** Sole Code Mode wire: `run_code`. Sub-calls re-enter the tool pipeline via bridge. */
export interface CodeToolCallResult {
  readonly content: string;
  readonly isError?: boolean;
}

/**
 * Host bridge so `await tools.name(args)` re-enters the live tool waterfall
 * (Codex / dsh code-mode nested dispatch). Omit → worker snippet only.
 */
export interface CodeToolBridge {
  /** Names exposed on the `tools` Proxy (exclude `run_code` itself). */
  readonly listNames: () => readonly string[];
  readonly call: (
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ) => Promise<CodeToolCallResult>;
}

function flattenToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else parts.push(JSON.stringify(block));
  }
  return parts.join("");
}

function nextCodeCallId(): string {
  return `code-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a bridge over a live {@link ToolRegistry} (same waterfall as the agent).
 * Nested calls cannot target `run_code` (no recursion).
 */
export function createRegistryCodeToolBridge(
  registry: ToolRegistry,
  options?: {
    /** Prefer this so nested calls share policy / settle with the agent. */
    readonly pipeline?: ToolPipeline;
    /**
     * Optional full override. Defaults to `runTool` (± pipeline).
     */
    readonly run?: (
      name: string,
      args: unknown,
      signal?: AbortSignal,
    ) => Promise<CodeToolCallResult>;
  },
): CodeToolBridge {
  return {
    listNames() {
      return registry
        .list()
        .map((t) => t.name)
        .filter((n) => n !== "run_code");
    },
    async call(name, args, signal) {
      if (name === "run_code") {
        return {
          content: "nested run_code is not allowed",
          isError: true,
        };
      }
      if (options?.run) return options.run(name, args, signal);
      if (!registry.get(name)) {
        return { content: `unknown tool: ${name}`, isError: true };
      }
      const result = await runTool({
        registry,
        call: {
          id: nextCodeCallId(),
          name,
          arguments: args ?? {},
        },
        ...(signal ? { signal } : {}),
        ...(options?.pipeline ? { pipeline: options.pipeline } : {}),
      });
      return {
        content: flattenToolContent(result.content),
        ...(result.isError ? { isError: true as const } : {}),
      };
    },
  };
}

function buildToolsProxy(
  bridge: CodeToolBridge,
  signal?: AbortSignal,
): Record<string, (args?: unknown) => Promise<string>> {
  const callTool = (name: string) => async (args?: unknown) => {
    const out = await bridge.call(name, args ?? {}, signal);
    if (out.isError) {
      throw new Error(`tools.${name} failed: ${out.content}`);
    }
    return out.content;
  };
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      const names = bridge.listNames();
      if (!names.includes(prop)) {
        return async () => {
          throw new Error(`unknown tool: ${prop}`);
        };
      }
      return callTool(prop);
    },
    ownKeys() {
      return [...bridge.listNames()];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "string" && bridge.listNames().includes(prop)) {
        return {
          enumerable: true,
          configurable: true,
          writable: false,
          value: callTool(prop),
        };
      }
      return undefined;
    },
  });
}

/**
 * In-process program with `tools` / `console` (Codex/dsh code-mode shape).
 * Source is the body of an async function — top-level `await` / `return` work.
 * When a bridge is wired, this path is preferred over Worker/SSH snippet runners
 * so nested `tools.*` can re-enter the host pipeline.
 */
export async function runCodeWithTools(
  source: string,
  bridge: CodeToolBridge,
  signal?: AbortSignal,
  opts?: {
    readonly timeoutMs?: number;
    readonly maxTimeoutMs?: number;
    readonly defaultTimeoutMs?: number;
    readonly maxOutputBytes?: number;
  },
): Promise<CodeRunResult> {
  const def = opts?.defaultTimeoutMs ?? DEFAULT_CODE_TIMEOUT_MS;
  const max = opts?.maxTimeoutMs ?? DEFAULT_CODE_MAX_TIMEOUT_MS;
  const timeoutMs = clampCodeTimeout(opts?.timeoutMs, def, max);
  const maxOutputBytes = opts?.maxOutputBytes ?? DEFAULT_CODE_MAX_OUTPUT_BYTES;
  const chunks: string[] = [];
  const errChunks: string[] = [];
  const consoleShim = {
    log: (...a: unknown[]) => {
      chunks.push(a.map(String).join(" "));
    },
    error: (...a: unknown[]) => {
      errChunks.push(a.map(String).join(" "));
    },
  };
  const tools = buildToolsProxy(bridge, signal);
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(
    "tools",
    "console",
    `"use strict";\n${source}`,
  );

  if (signal?.aborted) {
    return { stdout: "", stderr: "", error: "aborted" };
  }

  const stop = new AbortController();
  const onOuterAbort = () => stop.abort("aborted");
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => stop.abort("timeout"), timeoutMs);

  try {
    const value = await Promise.race([
      fn(tools, consoleShim),
      new Promise<never>((_, reject) => {
        stop.signal.addEventListener(
          "abort",
          () => {
            if (signal?.aborted || stop.signal.reason === "aborted") {
              reject(new DOMException("aborted", "AbortError"));
            } else {
              reject(new Error(`timeout after ${timeoutMs}ms`));
            }
          },
          { once: true },
        );
      }),
    ]);
    const rawStdout = [chunks.join("\n"), value === undefined ? null : String(value)]
      .filter(Boolean)
      .join("\n");
    const stdoutBound = boundCodeOutput(rawStdout, maxOutputBytes);
    const stderrBound = boundCodeOutput(errChunks.join("\n"), maxOutputBytes);
    return {
      stdout: stdoutBound.text,
      stderr: stderrBound.text,
      ...(stdoutBound.truncated || stderrBound.truncated
        ? { truncated: true }
        : {}),
    };
  } catch (err) {
    if (
      signal?.aborted ||
      (err instanceof DOMException && err.name === "AbortError")
    ) {
      return { stdout: "", stderr: "", error: "aborted" };
    }
    const message = err instanceof Error ? err.message : String(err);
    const stdoutBound = boundCodeOutput(chunks.join("\n"), maxOutputBytes);
    const stderrBound = boundCodeOutput(errChunks.join("\n"), maxOutputBytes);
    return {
      stdout: stdoutBound.text,
      stderr: stderrBound.text,
      error: message,
      ...(stdoutBound.truncated || stderrBound.truncated
        ? { truncated: true }
        : {}),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Sole Code Mode wire: `run_code`. With a bridge, programs call `await tools.name(args)`. */
export function createRunCodeTool(
  runtime: CodeRuntime,
  bridge?: CodeToolBridge,
): ToolDefinition {
  const defaultMs = runtime.timeout.defaultMs;
  const maxMs = runtime.timeout.maxMs;
  const toolsHint = bridge
    ? " Call host tools as `await tools.<name>(args)` (names from the live registry, excluding run_code). Only printed/returned text is program output — curate it. Nested calls re-enter the tool waterfall (in-process AsyncFunction; Worker/SSH snippet runner unused while bridged)."
    : " Isolated worker/SSH snippet only (no nested tools).";
  return {
    name: "run_code",
    description:
      "Run a short JavaScript program (async function body; top-level await/return work)." +
      toolsHint +
      " Experimental.",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: bridge
            ? "JavaScript body of an async function. Use await tools.name(args) for nested tools."
            : "JavaScript source",
        },
        timeoutMs: {
          type: "number",
          description:
            `Positive elapsed-time budget in milliseconds. Default ${defaultMs}; capped at ${maxMs}. Zero does not disable the deadline.`,
        },
      },
      required: ["source"],
    },
    async execute(args, signal) {
      const raw = args as { source?: string; timeoutMs?: number };
      const source = String(raw.source ?? "");
      try {
        const out = bridge
          ? await runCodeWithTools(source, bridge, signal, {
              ...(raw.timeoutMs !== undefined
                ? { timeoutMs: raw.timeoutMs }
                : {}),
              defaultTimeoutMs: defaultMs,
              maxTimeoutMs: maxMs,
              maxOutputBytes: runtime.maxOutputBytes,
            })
          : await runtime.run(source, signal, {
              ...(raw.timeoutMs !== undefined
                ? { timeoutMs: raw.timeoutMs }
                : {}),
            });
        const truncationNote = out.truncated
          ? `\n...[output truncated to ${runtime.maxOutputBytes} bytes]`
          : "";
        if (out.error) {
          return {
            content: `error: ${out.error}\nstdout:\n${out.stdout}\nstderr:\n${out.stderr}${truncationNote}`,
            isError: true,
          };
        }
        return {
          content: [out.stdout, out.stderr ? `stderr:\n${out.stderr}` : "", truncationNote]
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
