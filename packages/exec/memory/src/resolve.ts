/**
 * Resolve which curated MemoryProvider to use (file default · optional HTTP).
 * Mirrors Hermes `memory.provider` single-select; curated file remains default.
 */

import { createCuratedMemoryStore, type CreateCuratedMemoryStoreOptions } from "./store.js";
import { createHttpMemoryProvider, type HttpMemoryProviderOptions } from "./http.js";
import type { MemoryProvider } from "./provider.js";

export interface ResolveMemoryProviderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly file?: CreateCuratedMemoryStoreOptions;
  readonly http?: Partial<HttpMemoryProviderOptions>;
  /**
   * Force provider kind. When omitted, reads `XRK_MEMORY_PROVIDER`
   * (`file` | `http`; default `file`).
   */
  readonly kind?: "file" | "http";
}

/** Wrap the disk store as a named {@link MemoryProvider}. */
export function createFileMemoryProvider(
  options?: CreateCuratedMemoryStoreOptions,
): MemoryProvider {
  const store = createCuratedMemoryStore(options);
  return {
    ...store,
    providerName: "file",
    isAvailable: () => true,
  };
}

/**
 * Pick file (default) or HTTP curated provider.
 * HTTP requires `XRK_MEMORY_HTTP_URL` (or `options.http.baseUrl`).
 */
export async function resolveMemoryProvider(
  options: ResolveMemoryProviderOptions = {},
): Promise<MemoryProvider> {
  const env = options.env ?? process.env;
  const kindRaw = (
    options.kind ??
    String(env.XRK_MEMORY_PROVIDER ?? "file").trim().toLowerCase()
  );
  const kind = kindRaw === "http" ? "http" : "file";
  if (kind === "http") {
    const baseUrl =
      options.http?.baseUrl?.trim() ||
      String(env.XRK_MEMORY_HTTP_URL ?? "").trim();
    if (!baseUrl) {
      throw new Error(
        "XRK_MEMORY_PROVIDER=http requires XRK_MEMORY_HTTP_URL (or http.baseUrl)",
      );
    }
    const token =
      options.http?.token?.trim() ||
      String(env.XRK_MEMORY_HTTP_TOKEN ?? "").trim() ||
      undefined;
    return createHttpMemoryProvider({
      baseUrl,
      ...(token ? { token } : {}),
      ...(options.http?.fetchImpl ? { fetchImpl: options.http.fetchImpl } : {}),
      ...(options.http?.dir ? { dir: options.http.dir } : {}),
      ...(options.http?.timeoutMs !== undefined
        ? { timeoutMs: options.http.timeoutMs }
        : {}),
    });
  }
  return createFileMemoryProvider(options.file);
}
