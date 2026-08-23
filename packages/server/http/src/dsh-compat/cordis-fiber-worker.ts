/**
 * Cordis fiber child — loads community host.mjs in an isolated Node process.
 * Activated when parent sets XRK_CORDIS_FIBER_WORKER=1 (see cordis-fiber-runner.ts).
 */
import type { CordisRpcHandler } from "./cordis-registry.js";
import { tryApplyHostModule } from "./xrk-host-apply.js";

interface WorkerInit {
  readonly type: "init";
  readonly packageName: string;
  readonly pkgRoot: string;
  readonly pluginsDir?: string;
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
}

interface WorkerInvoke {
  readonly type: "invoke";
  readonly id: number;
  readonly channel: string;
  readonly endpoint: string;
  readonly payload: Record<string, unknown>;
}

type WorkerMessage = WorkerInit | WorkerInvoke;

function channelKey(channel: string): string {
  const trimmed = channel.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

function pickHandler(
  handlers: Record<string, CordisRpcHandler>,
  channel: string,
): CordisRpcHandler | undefined {
  const key = channelKey(channel);
  return (
    handlers[channel] ??
    handlers[`/${key}`] ??
    handlers[key] ??
    undefined
  );
}

async function runCordisFiberWorkerLoop(): Promise<void> {
  let rpcHandlers: Record<string, CordisRpcHandler> = {};

  process.on("message", (raw: WorkerMessage) => {
    void (async () => {
      if (!raw || typeof raw !== "object") return;
      if (raw.type === "init") {
        try {
        const contribution = await tryApplyHostModule(
          raw.pkgRoot,
          raw.packageName,
          {
            ...(raw.pluginsDir === undefined
              ? {}
              : { pluginsDir: raw.pluginsDir }),
            ...(raw.xrkHome === undefined ? {} : { xrkHome: raw.xrkHome }),
            ...(raw.workspaceRoot === undefined
              ? {}
              : { workspaceRoot: raw.workspaceRoot }),
          },
        );
        rpcHandlers = contribution?.rpc ?? {};
        process.send?.({
          type: "ready",
          rpcChannels: Object.keys(rpcHandlers),
        });
      } catch (err) {
        process.send?.({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        }
        return;
      }
      if (raw.type === "invoke") {
      try {
        const handler = pickHandler(rpcHandlers, raw.channel);
        if (!handler) {
          process.send?.({
            type: "rpc-result",
            id: raw.id,
            error: `unknown-channel:${raw.channel}`,
          });
          return;
        }
        const result = await handler(raw.endpoint, raw.payload);
        process.send?.({ type: "rpc-result", id: raw.id, result });
      } catch (err) {
        process.send?.({
          type: "rpc-result",
          id: raw.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    })();
  });
}

export function isCordisFiberWorkerProcess(): boolean {
  return process.env.XRK_CORDIS_FIBER_WORKER === "1";
}

if (isCordisFiberWorkerProcess()) {
  void runCordisFiberWorkerLoop();
}
