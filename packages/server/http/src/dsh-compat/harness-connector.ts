/**
 * AI Office → Harness webhook surface (`/api/harness/connector/*`).
 * Jobs persist under ~/.xrk/harness-connector when xrkHome is wired.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { parseJsonBody, drainMutatingBody } from "./underlying/http-kit.js";
import {
  getConnectorJob,
  upsertConnectorJob,
  touchConnectorHeartbeat,
  type ConnectorJobRecord,
} from "./harness-connector-store.js";

export interface HarnessConnectorOptions {
  readonly xrkHome?: string;
  readonly onJobAccepted?: (job: {
    readonly id: string;
    readonly workspace?: string;
    readonly instruction?: string;
  }) => Promise<{ readonly sessionId?: string } | void>;
}

const PROTOCOL = "office-harness.v1";

function parseJobPath(pathname: string): { jobId: string; action: string } | null {
  const m = pathname.match(
    /^\/api\/harness\/connector\/jobs\/([^/]+)(?:\/([a-z]+))?$/,
  );
  if (!m) return null;
  return { jobId: decodeURIComponent(m[1]!), action: m[2] ?? "get" };
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function maybeBridgeJob(
  row: ConnectorJobRecord,
  options?: HarnessConnectorOptions,
): Promise<ConnectorJobRecord> {
  const hook = options?.onJobAccepted;
  if (!hook) return row;
  const instruction = row.instruction?.trim();
  if (!instruction) return row;
  if (row.state !== "accepted" && row.state !== "pending") return row;
  try {
    const bridged = await hook({
      id: row.id,
      ...(row.workspace ? { workspace: row.workspace } : {}),
      instruction,
    });
    if (bridged?.sessionId) {
      return {
        ...row,
        state: "running",
        progress: Math.max(row.progress, 5),
        result: { sessionId: bridged.sessionId },
        updatedAt: new Date().toISOString(),
      };
    }
  } catch {
    /* bridge is best-effort */
  }
  return row;
}

function persistJob(
  row: ConnectorJobRecord,
  options: HarnessConnectorOptions,
): ConnectorJobRecord {
  return upsertConnectorJob(row, options.xrkHome);
}

export async function handleHarnessConnectorHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: HarnessConnectorOptions = {},
): Promise<boolean> {
  if (!pathname.startsWith("/api/harness/connector")) return false;
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/api/harness/connector/heartbeat") {
    if (method === "POST") await drainMutatingBody(req);
    const at = touchConnectorHeartbeat(options.xrkHome);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        protocol: PROTOCOL,
        timestamp: at,
        adapter: DSH_COMPAT_ADAPTER,
      }),
    );
    return true;
  }

  if (pathname === "/api/harness/connector/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    writeSse(res, "hello", { protocol: PROTOCOL, adapter: DSH_COMPAT_ADAPTER });
    const timer = setInterval(() => {
      writeSse(res, "heartbeat", { timestamp: Date.now() });
    }, 25_000);
    req.on("close", () => {
      clearInterval(timer);
    });
    return true;
  }

  const jobPath = parseJobPath(pathname);
  if (jobPath) {
    const { jobId, action } = jobPath;
    let row = getConnectorJob(jobId, options.xrkHome);
    if (!row && action === "accept") {
      const body = method === "POST" ? await parseJsonBody(req) : {};
      row = {
        id: jobId,
        state: "accepted",
        progress: 0,
        updatedAt: new Date().toISOString(),
        ...(typeof body.workspace === "string"
          ? { workspace: body.workspace }
          : {}),
        ...(typeof body.instruction === "string"
          ? { instruction: body.instruction }
          : {}),
      };
      row = await maybeBridgeJob(row, options);
      row = persistJob(row, options);
    }
    if (!row) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "job not found" }));
      return true;
    }
    if (action === "accept" && method === "POST") {
      row = { ...row, state: "accepted", updatedAt: new Date().toISOString() };
      row = await maybeBridgeJob(row, options);
      row = persistJob(row, options);
    } else if (action === "renew" && method === "POST") {
      row = persistJob(
        { ...row, updatedAt: new Date().toISOString() },
        options,
      );
    } else if (action === "progress" && method === "POST") {
      const body = await parseJsonBody(req);
      const progress =
        typeof body.progress === "number" ? body.progress : row.progress;
      row = persistJob(
        {
          ...row,
          state: "running",
          progress,
          updatedAt: new Date().toISOString(),
        },
        options,
      );
    } else if (action === "approval" && method === "POST") {
      await parseJsonBody(req);
      row = persistJob(
        { ...row, updatedAt: new Date().toISOString() },
        options,
      );
    } else if (action === "result" && method === "POST") {
      const body = await parseJsonBody(req);
      row = persistJob(
        {
          ...row,
          state: "completed",
          progress: 100,
          result: body.result ?? body,
          updatedAt: new Date().toISOString(),
        },
        options,
      );
    } else if (action === "fail" && method === "POST") {
      const body = await parseJsonBody(req);
      row = persistJob(
        {
          ...row,
          state: "failed",
          error:
            typeof body.error === "string"
              ? body.error
              : typeof body.message === "string"
                ? body.message
                : "failed",
          updatedAt: new Date().toISOString(),
        },
        options,
      );
    } else if (method === "POST" || method === "PUT") {
      await parseJsonBody(req);
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, job: row, adapter: DSH_COMPAT_ADAPTER }));
    return true;
  }

  if (pathname === "/api/harness/connector/jobs" && method === "POST") {
    const body = await parseJsonBody(req);
    const id =
      typeof body.id === "string" && body.id.trim()
        ? body.id.trim()
        : randomUUID();
    let row: ConnectorJobRecord = {
      id,
      state: "pending",
      progress: 0,
      updatedAt: new Date().toISOString(),
      ...(typeof body.workspace === "string" ? { workspace: body.workspace } : {}),
      ...(typeof body.instruction === "string"
        ? { instruction: body.instruction }
        : {}),
    };
    if (row.instruction?.trim()) {
      row = await maybeBridgeJob({ ...row, state: "accepted" }, options);
    }
    row = persistJob(row, options);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, job: row, adapter: DSH_COMPAT_ADAPTER }));
    return true;
  }

  if (method === "POST" || method === "PUT") await drainMutatingBody(req);
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({ ok: true, path: pathname, adapter: DSH_COMPAT_ADAPTER }),
  );
  return true;
}

export function isHarnessConnectorPath(pathname: string): boolean {
  return pathname.startsWith("/api/harness/connector");
}
