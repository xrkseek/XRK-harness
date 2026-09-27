/**
 * Resolve which ExecEnvironment to use (local default · memory · optional HTTP).
 * SSH stays on `createSshExecutionWorld` (Host remoteExecution) — not merged here.
 */

import { createHttpExecEnvironment, type HttpExecEnvironmentOptions } from "./http.js";
import { createLocalExecEnvironment, type LocalExecEnvironmentOptions } from "./local.js";
import {
  createMemoryExecEnvironment,
  type MemoryExecEnvironmentOptions,
} from "./memory.js";
import type { ExecEnvironmentKind, ExecEnvironmentProvider } from "./types.js";

export interface ResolveExecEnvironmentOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly local?: LocalExecEnvironmentOptions;
  readonly http?: Partial<HttpExecEnvironmentOptions>;
  readonly memory?: MemoryExecEnvironmentOptions;
  /**
   * Force kind. When omitted, reads `XRK_EXEC_ENVIRONMENT`
   * (`local` | `http` | `memory`; default `local`).
   */
  readonly kind?: ExecEnvironmentKind;
}

function kindFromRaw(raw: string): ExecEnvironmentKind {
  const k = raw.trim().toLowerCase();
  if (k === "http" || k === "memory") return k;
  return "local";
}

/**
 * Pick local (default), memory (CI / tests), or HTTP serverless provider.
 * HTTP requires `XRK_EXEC_ENVIRONMENT_URL` (or `options.http.baseUrl`).
 */
export function resolveExecEnvironment(
  options: ResolveExecEnvironmentOptions = {},
): ExecEnvironmentProvider {
  const env = options.env ?? process.env;
  const kind = kindFromRaw(
    options.kind ?? String(env.XRK_EXEC_ENVIRONMENT ?? "local"),
  );
  if (kind === "http") {
    const baseUrl =
      options.http?.baseUrl?.trim() ||
      String(env.XRK_EXEC_ENVIRONMENT_URL ?? "").trim();
    if (!baseUrl) {
      throw new Error(
        "XRK_EXEC_ENVIRONMENT=http requires XRK_EXEC_ENVIRONMENT_URL (or http.baseUrl)",
      );
    }
    const token =
      options.http?.token?.trim() ||
      String(env.XRK_EXEC_ENVIRONMENT_TOKEN ?? "").trim() ||
      undefined;
    return createHttpExecEnvironment({
      baseUrl,
      ...(token ? { token } : {}),
      ...(options.http?.fetchImpl ? { fetchImpl: options.http.fetchImpl } : {}),
      ...(options.http?.timeoutMs !== undefined
        ? { timeoutMs: options.http.timeoutMs }
        : {}),
      ...(options.http?.remoteWorkspaceRoot
        ? { remoteWorkspaceRoot: options.http.remoteWorkspaceRoot }
        : {}),
    });
  }
  if (kind === "memory") {
    return createMemoryExecEnvironment(options.memory);
  }
  return createLocalExecEnvironment(options.local);
}
