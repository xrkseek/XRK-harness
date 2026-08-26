/**
 * Cordis fiber subprocess runner — isolated Node child for community host.mjs RPC.
 */
import { existsSync } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CordisRpcHandler } from "./cordis-registry.js";
import type { DshAdapterContribution, DshCompatWireOptions } from "./adapter-types.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

function resolveFiberWorkerEntry(): string {
  const beside = fileURLToPath(
    new URL("./cordis-fiber-worker.js", import.meta.url),
  );
  if (existsSync(beside)) return beside;
  const fromSrc = fileURLToPath(
    new URL("../../../dist/dsh-compat/cordis-fiber-worker.js", import.meta.url),
  );
  if (existsSync(fromSrc)) return fromSrc;
  return beside;
}

const WORKER_PATH = resolveFiberWorkerEntry();

interface PendingReq {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface FiberSession {
  readonly child: ChildProcess;
  readonly packageName: string;
  rpcChannels: string[];
  nextId: number;
  pending: Map<number, PendingReq>;
}

const sessions = new Map<string, FiberSession>();

function normalizeName(packageName: string): string {
  return packageName.trim();
}

export function isCordisFiberRunning(packageName: string): boolean {
  return sessions.has(normalizeName(packageName));
}

export function listCordisFiberPackages(): readonly string[] {
  return [...sessions.keys()];
}

export async function stopCordisFiber(packageName: string): Promise<void> {
  const name = normalizeName(packageName);
  const session = sessions.get(name);
  if (!session) return;
  session.child.kill();
  sessions.delete(name);
}

export async function startCordisFiber(options: {
  readonly packageName: string;
  readonly pkgRoot: string;
  readonly pluginsDir?: string;
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
}): Promise<{ ok: boolean; rpcChannels: readonly string[]; error?: string }> {
  const name = normalizeName(options.packageName);
  if (!name) return { ok: false, rpcChannels: [], error: "empty-name" };
  await stopCordisFiber(name);

  return new Promise((resolve) => {
    const child = fork(WORKER_PATH, [], {
      env: { ...process.env, XRK_CORDIS_FIBER_WORKER: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const session: FiberSession = {
      child,
      packageName: name,
      rpcChannels: [],
      nextId: 1,
      pending: new Map(),
    };

    const fail = (message: string) => {
      sessions.delete(name);
      child.kill();
      resolve({ ok: false, rpcChannels: [], error: message });
    };

    child.on("message", (msg: unknown) => {
      if (!msg || typeof msg !== "object") return;
      const row = msg as Record<string, unknown>;
      if (row.type === "ready") {
        session.rpcChannels = Array.isArray(row.rpcChannels)
          ? row.rpcChannels.map((c) => String(c))
          : [];
        sessions.set(name, session);
        resolve({ ok: true, rpcChannels: session.rpcChannels });
        return;
      }
      if (row.type === "error") {
        fail(String(row.message ?? "fiber-init-failed"));
        return;
      }
      if (row.type === "rpc-result") {
        const id = Number(row.id);
        const pending = session.pending.get(id);
        if (!pending) return;
        session.pending.delete(id);
        if (row.error) pending.reject(new Error(String(row.error)));
        else pending.resolve(row.result);
      }
    });

    child.on("exit", () => {
      sessions.delete(name);
    });

    child.send({
      type: "init",
      packageName: name,
      pkgRoot: options.pkgRoot,
      pluginsDir: options.pluginsDir,
      xrkHome: options.xrkHome,
      workspaceRoot: options.workspaceRoot,
    });

    setTimeout(() => {
      if (!sessions.has(name)) {
        fail("fiber-init-timeout");
      }
    }, 60_000);
  });
}

export async function invokeCordisFiberRpc(
  packageName: string,
  channel: string,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const session = sessions.get(normalizeName(packageName));
  if (!session) throw new Error("cordis-fiber-not-running");
  const id = session.nextId++;
  return new Promise((resolve, reject) => {
    session.pending.set(id, { resolve, reject });
    session.child.send({ type: "invoke", id, channel, endpoint, payload });
    setTimeout(() => {
      if (!session.pending.has(id)) return;
      session.pending.delete(id);
      reject(new Error("cordis-fiber-invoke-timeout"));
    }, 60_000);
  });
}

/** Proxy RPC handlers that forward to an active fiber subprocess. */
export function createCordisFiberRpcContribution(
  packageName: string,
  rpcChannels: readonly string[],
): DshAdapterContribution | undefined {
  const channels = rpcChannels.filter((c) => c.trim());
  if (channels.length === 0) return undefined;
  const id = packageName.replace(/^@/, "").replace(/\//g, "-");
  const rpc: Record<string, CordisRpcHandler> = {};
  for (const channel of channels) {
    const key = channel.startsWith("/") ? channel : `/${channel}`;
    rpc[key] = async (endpoint, payload) =>
      invokeCordisFiberRpc(packageName, key, endpoint, payload);
  }
  return {
    meta: {
      id: `${id}-fiber`,
      package: packageName,
      httpPrefixes: ["fiber"],
      rpcChannels: channels,
    },
    rpc,
  };
}

export async function applyHostPackageWithFiberFallback(
  ctx: DshCompatWireOptions,
  packageName: string,
  pkgRoot: string,
  inProcessOk: boolean,
  inProcessContribution: DshAdapterContribution | undefined,
): Promise<{
  ok: boolean;
  fiber: boolean;
  rpcChannels: readonly string[];
}> {
  if (inProcessOk && inProcessContribution) {
    return {
      ok: true,
      fiber: false,
      rpcChannels: inProcessContribution.meta.rpcChannels ?? [],
    };
  }
  const fiber = await startCordisFiber({
    packageName,
    pkgRoot,
    ...(ctx.pluginsDir === undefined ? {} : { pluginsDir: ctx.pluginsDir }),
    ...(ctx.xrkHome === undefined ? {} : { xrkHome: ctx.xrkHome }),
    ...(ctx.workspaceRoot === undefined
      ? {}
      : { workspaceRoot: ctx.workspaceRoot }),
  });
  if (!fiber.ok) {
    return { ok: false, fiber: true, rpcChannels: [] };
  }
  return { ok: true, fiber: true, rpcChannels: fiber.rpcChannels };
}

export const CORDIS_FIBER_ADAPTER = DSH_COMPAT_ADAPTER;
