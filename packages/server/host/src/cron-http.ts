/**
 * Host cron read API — the `frontend/schedule` surface promised in docs/cron.md.
 *
 * The cron scheduler lives in the Host process (`cronBox.scheduler`), so the
 * browser has no direct channel to it: `cronjob` is a model-facing tool and
 * Face never sees the scheduler instance. These endpoints close that gap with
 * zero changes to the Face/mux protocol: a composite `tryHandleExtraApi`
 * claims `/api/cron/*` before falling back to Face's own extras.
 *
 * Read-only for now (list + per-job run logs). Mutations keep flowing through
 * the `cronjob` tool (create/pause/resume/run/remove), which is the
 * model-facing path; a UI editor would add PATCH/POST here later.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CronScheduler } from "@xrkseek/server-cron";

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/** Parse `/api/cron/jobs/<id>/logs` — returns the id segment when present. */
function jobIdFrom(url: URL): string | undefined {
  const prefix = "/api/cron/jobs/";
  const path = url.pathname;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  if (rest === "") return undefined;
  // `/api/cron/jobs/<id>/logs` — anything deeper is not a valid route.
  const segments = rest.split("/");
  if (segments.length > 2 || segments[segments.length - 1] !== "logs") {
    return undefined;
  }
  const id = segments[0];
  return id !== undefined && id.length > 0 ? id : undefined;
}

/**
 * Build the cron API hook. Claims `/api/cron/*` (GET only) and returns true
 * when it did; otherwise returns false so the caller can fall through to
 * Face's own extra-API handling.
 */
export function createCronApiHandler(options: {
  readonly resolveScheduler: () => CronScheduler | undefined;
  /** Required: this hook runs BEFORE the shared /api auth gate. */
  readonly checkAuth: (req: IncomingMessage) => boolean;
}): (req: IncomingMessage, res: ServerResponse) => boolean {
  const { resolveScheduler, checkAuth } = options;
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/cron/")) return false;
    if ((req.method ?? "GET").toUpperCase() !== "GET") {
      sendError(res, 405, "cron API is read-only; use the cronjob tool to mutate jobs");
      return true;
    }
    if (!checkAuth(req)) {
      sendError(res, 401, "unauthorized");
      return true;
    }
    const scheduler = resolveScheduler();
    if (!scheduler) {
      sendError(res, 503, "cron scheduler is not running (XRK_CRON=0 or disabled)");
      return true;
    }
    if (url.pathname === "/api/cron/jobs" || url.pathname === "/api/cron/jobs/") {
      const jobs = scheduler.store.list();
      sendJson(res, 200, { jobs });
      return true;
    }
    const jobId = jobIdFrom(url);
    if (jobId !== undefined) {
      const job = scheduler.store.get(jobId);
      if (!job) {
        sendError(res, 404, `cron job not found: ${jobId}`);
        return true;
      }
      const limitRaw = url.searchParams.get("limit");
      const limit =
        limitRaw !== null && /^\d+$/.test(limitRaw)
          ? Math.max(1, Math.min(200, Number(limitRaw)))
          : 50;
      const executions = scheduler.executions?.list({ jobId, limit }) ?? [];
      sendJson(res, 200, { job, runs: executions });
      return true;
    }
    sendError(res, 404, `unknown cron route: ${url.pathname}`);
    return true;
  };
}
