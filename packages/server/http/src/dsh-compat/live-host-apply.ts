/**
 * In-process community host halves (WB / OFM / host.mjs) — live dispose gate
 * so soft-disable / reload can tear down without a full Host restart.
 */
import type { CordisHttpHandler, CordisRpcHandler } from "./cordis-registry.js";

export type LiveHostDispose = () => void | Promise<void>;

interface LiveHostSession {
  readonly packageName: string;
  disposed: boolean;
  readonly dispose: LiveHostDispose;
}

const sessions = new Map<string, LiveHostSession>();

function normalizeName(packageName: string): string {
  return packageName.trim();
}

/** Test / registry reset. */
export function resetLiveHostApply(): void {
  sessions.clear();
}

export function isLiveHostApplyActive(packageName: string): boolean {
  const row = sessions.get(normalizeName(packageName));
  return Boolean(row && !row.disposed);
}

export function listLiveHostApplyPackages(): readonly string[] {
  return [...sessions.values()]
    .filter((row) => !row.disposed)
    .map((row) => row.packageName);
}

/**
 * Replace any prior live session for `packageName`. Caller owns Cordis cleanup
 * inside `dispose`; this registry only tracks the gate + runs dispose once.
 */
export async function registerLiveHostApply(
  packageName: string,
  dispose: LiveHostDispose,
): Promise<void> {
  const name = normalizeName(packageName);
  if (!name) return;
  await disposeLiveHostApply(name);
  sessions.set(name, {
    packageName: name,
    disposed: false,
    dispose,
  });
}

/** Soft-disable / reload / fiber stop — idempotent. */
export async function disposeLiveHostApply(
  packageName: string,
): Promise<boolean> {
  const name = normalizeName(packageName);
  const row = sessions.get(name);
  if (!row || row.disposed) return false;
  row.disposed = true;
  sessions.delete(name);
  try {
    await row.dispose();
  } catch {
    /* best-effort — prefer unload over stuck registry */
  }
  return true;
}

/** Gate HTTP so disposed sessions stop claiming paths (duplicate re-apply safe). */
export function gateLiveHostHttp(
  packageName: string,
  http: readonly {
    readonly match: (pathname: string) => boolean;
    readonly handle: CordisHttpHandler;
  }[],
): Array<{
  match: (pathname: string) => boolean;
  handle: CordisHttpHandler;
}> {
  const name = normalizeName(packageName);
  return http.map((row) => ({
    match: row.match,
    handle: async (req, res, pathname) => {
      if (!isLiveHostApplyActive(name)) return false;
      return row.handle(req, res, pathname);
    },
  }));
}

/** Gate RPC channels the same way. */
export function gateLiveHostRpc(
  packageName: string,
  rpc: Readonly<Record<string, CordisRpcHandler>>,
): Record<string, CordisRpcHandler> {
  const name = normalizeName(packageName);
  const out: Record<string, CordisRpcHandler> = {};
  for (const [channel, handler] of Object.entries(rpc)) {
    out[channel] = async (endpoint, payload, req) => {
      if (!isLiveHostApplyActive(name)) {
        throw new Error(`host half disposed: ${name}`);
      }
      return handler(endpoint, payload, req);
    };
  }
  return out;
}
