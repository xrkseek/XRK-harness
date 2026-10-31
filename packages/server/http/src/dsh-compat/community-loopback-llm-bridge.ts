/**
 * Shared Cordis `llm.registerAdapter` → Face `syncCommunityLlmProvider` bridge
 * for loopback OpenAI community hosts (OFM, WorkBuddy, …).
 *
 * Host halves keep Cordis apply / credentials / HTTP; this module owns the
 * sync loop, fingerprints, retries, and optional GET nudge.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@xrkseek/cordis";
import type { CordisHttpRow } from "./cordis-connection-bridge.js";
import {
  asCommunityLlmModelRows,
  baseUrlFromCommunityModels,
  communityLlmSyncFingerprint,
  createCommunityLlmSyncScheduler,
  dropStaleCommunityLlmFingerprints,
  enrichCommunityModelsWithResolve,
  isUsableCommunityLoopbackBaseUrl,
  listModelsForCommunitySync,
  type CommunityLlmSyncCatalog,
  type CommunityLlmSyncModelRow,
} from "./community-llm-host-sync.js";

export type CommunityLoopbackEndpoint = {
  readonly baseUrl?: string;
  readonly apiKey?: string;
};

export type CommunityLoopbackAdapter = {
  listModels?: (provider: string) => Promise<readonly unknown[]>;
  catalog?: CommunityLlmSyncCatalog;
  resolveModel?: (provider: string, model: string) => Promise<unknown>;
  resolveApiKey?: () => Promise<string | undefined>;
};

export type CommunityLoopbackLlmBridge = {
  readonly scheduler: ReturnType<typeof createCommunityLlmSyncScheduler>;
  /** Last good baseUrl per provider (shim / forward port can briefly vanish). */
  readonly lastBaseUrlByProvider: Map<string, string>;
  /** Live adapters keyed by provider id (status enrichment). */
  readonly adaptersByProvider: Map<string, CommunityLoopbackAdapter>;
  provideLlm(root: Context): void;
  /** Re-run Face sync on unsettled GET under any prefix (status / summary). */
  nudgeHttpOnGet(
    http: CordisHttpRow[],
    options?: {
      readonly prefixes?: readonly string[];
      readonly pathTest?: (pathname: string) => boolean;
    },
  ): void;
  dispose(): void;
};

/** Build Face loopback from host/port/key (rejects pre-listen port:0). */
export function communityLoopbackEndpointFromBits(input: {
  readonly host?: unknown;
  readonly port?: unknown;
  readonly apiKey?: unknown;
}): CommunityLoopbackEndpoint {
  const key =
    typeof input.apiKey === "string" && input.apiKey.trim()
      ? input.apiKey.trim()
      : undefined;
  const port = Number(input.port);
  const host =
    typeof input.host === "string" && input.host.trim()
      ? input.host.trim()
      : "127.0.0.1";
  if (!Number.isFinite(port) || Math.trunc(port) < 1) {
    return key ? { apiKey: key } : {};
  }
  const baseUrl = `http://${host}:${Math.trunc(port)}/v1`.replace(/\/+$/, "");
  if (!isUsableCommunityLoopbackBaseUrl(baseUrl)) {
    return key ? { apiKey: key } : {};
  }
  return { baseUrl, ...(key ? { apiKey: key } : {}) };
}

/** In-process GET that captures JSON written via writeHead/end. */
export async function readCommunityJsonViaHttp(
  rows: readonly CordisHttpRow[],
  pathname: string,
): Promise<unknown | undefined> {
  const row = rows.find((item) => item.match(pathname));
  if (!row) return undefined;
  return await new Promise<unknown | undefined>((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (value: unknown | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = {
      method: "GET",
      url: pathname,
      headers: { host: "127.0.0.1" },
    } as IncomingMessage;
    const resState = { statusCode: 200, headersSent: false };
    const res = {
      writeHead(statusCode: number) {
        resState.statusCode = statusCode;
        resState.headersSent = true;
        return res;
      },
      setHeader() {
        return res;
      },
      write(chunk: unknown) {
        if (chunk !== undefined && chunk !== null) {
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
          );
        }
        return true;
      },
      end(chunk?: unknown) {
        if (chunk !== undefined && chunk !== null) {
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
          );
        }
        resState.headersSent = true;
        if (resState.statusCode !== 200) {
          finish(undefined);
          return res;
        }
        try {
          finish(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        } catch {
          finish(undefined);
        }
        return res;
      },
    } as unknown as ServerResponse;
    void Promise.resolve(row.handle(req, res, pathname))
      .then((handled) => {
        if (!handled) finish(undefined);
        if (!settled) {
          setTimeout(() => finish(undefined), 50).unref?.();
        }
      })
      .catch(() => finish(undefined));
  });
}

/**
 * Live forward port from a settings-shaped JSON blob (`forward.actualPort`).
 * Used when disk keeps requested `port: 0` after an ephemeral bind (OFM).
 */
export function communityLoopbackEndpointFromForwardSettings(
  settings: unknown,
): CommunityLoopbackEndpoint {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  const forward = (settings as { forward?: unknown }).forward;
  const forwardKey = (settings as { forwardKey?: unknown }).forwardKey;
  if (!forward || typeof forward !== "object" || Array.isArray(forward)) {
    return {};
  }
  const f = forward as {
    host?: unknown;
    port?: unknown;
    actualPort?: unknown;
    running?: unknown;
    enabled?: unknown;
  };
  if (f.running === false || f.enabled === false) return {};
  const port =
    Number(f.actualPort) > 0
      ? f.actualPort
      : Number(f.port) > 0
        ? f.port
        : undefined;
  return communityLoopbackEndpointFromBits({
    host: f.host,
    port,
    apiKey: forwardKey,
  });
}

export async function communityLoopbackEndpointFromSummaryHttp(
  rows: readonly CordisHttpRow[],
  summaryPath: string,
): Promise<CommunityLoopbackEndpoint> {
  const payload = await readCommunityJsonViaHttp(rows, summaryPath);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return communityLoopbackEndpointFromForwardSettings(
    (payload as { settings?: unknown }).settings,
  );
}

export function createCommunityLoopbackLlmBridge(options: {
  readonly syncCommunityLlmProvider?: (args: {
    readonly providerId: string;
    readonly displayName: string;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly models: readonly CommunityLlmSyncModelRow[];
  }) => void | Promise<void>;
  readonly displayName: (providerId: string) => string;
  /** Fallback apiKey when adapter + resolveEndpoint omit one. */
  readonly defaultApiKey?: (providerId: string) => string;
  /**
   * Extra endpoint bits before model-row baseUrl (disk forward, live summary).
   * Called once per syncer flush.
   */
  readonly resolveEndpoint?: () =>
    | CommunityLoopbackEndpoint
    | Promise<CommunityLoopbackEndpoint>;
  readonly logPrefix?: string;
  readonly onBatchError?: (error: unknown) => void;
}): CommunityLoopbackLlmBridge {
  let hostDisposed = false;
  const lastBaseUrlByProvider = new Map<string, string>();
  const adaptersByProvider = new Map<string, CommunityLoopbackAdapter>();
  const logPrefix = options.logPrefix ?? "community-llm";
  const scheduler = createCommunityLlmSyncScheduler({
    isDisposed: () => hostDisposed,
    ...(options.onBatchError ? { onBatchError: options.onBatchError } : {}),
  });

  const provideLlm = (root: Context): void => {
    (root as { on: (event: string, listener: () => void) => unknown }).on(
      "llm/adapters-updated",
      () => {
        void scheduler.runAll();
      },
    );

    root.provide("llm", {
      registerAdapter(
        providers: string[],
        adapter: CommunityLoopbackAdapter,
      ) {
        const ids = providers.map((p) => p.trim()).filter(Boolean);
        for (const id of ids) adaptersByProvider.set(id, adapter);
        let disposed = false;
        const sync = async (): Promise<boolean> => {
          if (disposed || hostDisposed || !options.syncCommunityLlmProvider) {
            return false;
          }
          if (ids.length === 0) return true;
          let allOk = true;
          const endpoint = (await options.resolveEndpoint?.()) ?? {};
          for (const providerId of ids) {
            try {
              const lastBaseUrl = lastBaseUrlByProvider.get(providerId);
              const hint =
                endpoint.baseUrl &&
                isUsableCommunityLoopbackBaseUrl(endpoint.baseUrl)
                  ? endpoint.baseUrl
                  : lastBaseUrl;
              const listed = await listModelsForCommunitySync(
                adapter,
                providerId,
                {
                  ...(hint !== undefined ? { lastBaseUrl: hint } : {}),
                },
              );
              const models = await enrichCommunityModelsWithResolve(
                adapter,
                providerId,
                asCommunityLlmModelRows(listed),
              );
              const baseUrlCandidate =
                baseUrlFromCommunityModels(listed) ??
                endpoint.baseUrl ??
                lastBaseUrl;
              const baseUrl = isUsableCommunityLoopbackBaseUrl(baseUrlCandidate)
                ? baseUrlCandidate.trim().replace(/\/+$/, "")
                : undefined;
              if (!baseUrl || models.length === 0) {
                allOk = false;
                console.warn(
                  `[${logPrefix}] syncCommunityLlmProvider skip ${providerId}: baseUrl=${baseUrl ?? "none"} models=${models.length} listed=${listed.length}`,
                );
                continue;
              }
              const fingerprint = communityLlmSyncFingerprint(
                providerId,
                baseUrl,
                models,
              );
              dropStaleCommunityLlmFingerprints(
                scheduler.fingerprints,
                providerId,
                baseUrl,
              );
              if (scheduler.fingerprints.has(fingerprint)) {
                continue;
              }
              const apiKey =
                (await adapter.resolveApiKey?.())?.trim() ||
                endpoint.apiKey ||
                options.defaultApiKey?.(providerId) ||
                `xrk-${providerId}`;
              await options.syncCommunityLlmProvider({
                providerId,
                displayName: options.displayName(providerId),
                baseUrl,
                apiKey,
                models,
              });
              lastBaseUrlByProvider.set(providerId, baseUrl);
              scheduler.fingerprints.add(fingerprint);
              console.info(
                `[${logPrefix}] syncCommunityLlmProvider ok ${providerId} models=${models.length} baseUrl=${baseUrl}`,
              );
            } catch (error) {
              allOk = false;
              console.warn(
                `[${logPrefix}] syncCommunityLlmProvider failed for ${providerId}`,
                error,
              );
            }
          }
          return allOk;
        };
        scheduler.addSyncer(sync);
        void scheduler.runAll();
        const release = (): void => {
          disposed = true;
          for (const id of ids) {
            if (adaptersByProvider.get(id) === adapter) {
              adaptersByProvider.delete(id);
            }
          }
          scheduler.markUnsettled();
        };
        return Object.assign(release, {
          replace(next: string[]) {
            for (const id of ids) {
              if (adaptersByProvider.get(id) === adapter) {
                adaptersByProvider.delete(id);
              }
            }
            ids.splice(
              0,
              ids.length,
              ...next.map((p) => p.trim()).filter(Boolean),
            );
            for (const id of ids) adaptersByProvider.set(id, adapter);
            scheduler.fingerprints.clear();
            scheduler.markUnsettled();
            void scheduler.runAll();
          },
        });
      },
      registerConfigurableProviders() {
        /* Face Settings cards are separate */
      },
      registerModelDiscovery() {
        /* optional probe button */
      },
    });
  };

  return {
    scheduler,
    lastBaseUrlByProvider,
    adaptersByProvider,
    provideLlm,
    nudgeHttpOnGet(http, nudgeOptions) {
      const prefixes = nudgeOptions?.prefixes;
      const pathTest = nudgeOptions?.pathTest;
      for (const row of http) {
        const inner = row.handle;
        row.handle = async (req, res, pathname) => {
          const handled = await inner(req, res, pathname);
          const method = (req.method ?? "GET").toUpperCase();
          if (
            handled &&
            !scheduler.settled() &&
            method === "GET" &&
            (pathTest?.(pathname) === true ||
              (prefixes?.some((p) => pathname.startsWith(p)) ?? false))
          ) {
            void scheduler.runAll();
          }
          return handled;
        };
      }
    },
    dispose() {
      hostDisposed = true;
    },
  };
}
