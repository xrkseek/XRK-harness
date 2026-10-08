/**
 * Host cron API — the `frontend/schedule` surface promised in docs/cron.md.
 *
 * The cron scheduler lives in the Host process (`cronBox.scheduler`), so the
 * browser has no direct channel to it: `cronjob` is a model-facing tool and
 * Face never sees the scheduler instance. These endpoints close that gap with
 * zero changes to the Face/mux protocol: a composite `tryHandleExtraApi`
 * claims `/api/cron/*` before falling back to Face's own extras.
 *
 * GET: list jobs + per-job run logs.
 * POST: pause / resume / remove / run — Settings Tasks tab mutations.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { nextRunAt, type CronScheduler } from "@xrkseek/server-cron";

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

type JobAction = "pause" | "resume" | "remove" | "run" | "logs";

/**
 * Parse `/api/cron/jobs/<id>` or `/api/cron/jobs/<id>/<action>`.
 * Returns undefined when the path is not a per-job route.
 */
function parseJobRoute(
  url: URL,
): { readonly id: string; readonly action?: JobAction } | undefined {
  const prefix = "/api/cron/jobs/";
  const path = url.pathname;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  if (rest === "") return undefined;
  const segments = rest.split("/").filter((s) => s.length > 0);
  if (segments.length === 0 || segments.length > 2) return undefined;
  const id = segments[0];
  if (!id) return undefined;
  if (segments.length === 1) return { id };
  const action = segments[1] as JobAction;
  if (
    action !== "pause" &&
    action !== "resume" &&
    action !== "remove" &&
    action !== "run" &&
    action !== "logs"
  ) {
    return undefined;
  }
  return { id, action };
}

/**
 * Build the cron API hook. Claims `/api/cron/*` and returns true when it did;
 * otherwise returns false so the caller can fall through to Face extras.
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

    const method = (req.method ?? "GET").toUpperCase();

    if (!checkAuth(req)) {
      sendError(res, 401, "unauthorized");
      return true;
    }
    const scheduler = resolveScheduler();
    if (!scheduler) {
      sendError(res, 503, "cron scheduler is not running (XRK_CRON=0 or disabled)");
      return true;
    }

    if (method === "GET") {
      if (url.pathname === "/api/cron/jobs" || url.pathname === "/api/cron/jobs/") {
        const jobs = scheduler.store.list();
        sendJson(res, 200, { jobs });
        return true;
      }
      const route = parseJobRoute(url);
      if (route !== undefined && (route.action === "logs" || route.action === undefined)) {
        if (route.action === undefined) {
          sendError(res, 404, `unknown cron route: ${url.pathname}`);
          return true;
        }
        const job = scheduler.store.get(route.id);
        if (!job) {
          sendError(res, 404, `cron job not found: ${route.id}`);
          return true;
        }
        const limitRaw = url.searchParams.get("limit");
        const limit =
          limitRaw !== null && /^\d+$/.test(limitRaw)
            ? Math.max(1, Math.min(200, Number(limitRaw)))
            : 50;
        const executions = scheduler.executions?.list({ jobId: route.id, limit }) ?? [];
        sendJson(res, 200, { job, runs: executions });
        return true;
      }
      sendError(res, 404, `unknown cron route: ${url.pathname}`);
      return true;
    }

    if (method === "POST") {
      const route = parseJobRoute(url);
      if (route === undefined || route.action === undefined || route.action === "logs") {
        sendError(res, 404, `unknown cron route: ${url.pathname}`);
        return true;
      }
      const job = scheduler.store.get(route.id);
      if (!job) {
        sendError(res, 404, `cron job not found: ${route.id}`);
        return true;
      }
      try {
        if (route.action === "pause") {
          const updated = scheduler.store.update(route.id, { enabled: false });
          sendJson(res, 200, { ok: true, job: updated });
          return true;
        }
        if (route.action === "resume") {
          const next = nextRunAt(job.schedule);
          const updated = scheduler.store.update(route.id, {
            enabled: true,
            nextRunAt: next,
          });
          sendJson(res, 200, { ok: true, job: updated });
          return true;
        }
        if (route.action === "remove") {
          const ok = scheduler.store.remove(route.id);
          if (!ok) {
            sendError(res, 404, `cron job not found: ${route.id}`);
            return true;
          }
          sendJson(res, 200, { ok: true, id: route.id, removed: true });
          return true;
        }
        if (route.action === "run") {
          // Job-level failure stays HTTP 200 with ok:false so the Tasks tab
          // can surface result.error without treating it as a transport error.
          void scheduler.runNow(route.id).then(
            (result) => {
              const after = scheduler.store.get(route.id);
              sendJson(res, 200, {
                ok: result.ok,
                result,
                ...(after ? { job: after } : {}),
              });
            },
            (err: unknown) => {
              sendError(
                res,
                500,
                err instanceof Error ? err.message : String(err),
              );
            },
          );
          return true;
        }
      } catch (err) {
        sendError(
          res,
          400,
          err instanceof Error ? err.message : String(err),
        );
        return true;
      }
      sendError(res, 404, `unknown cron route: ${url.pathname}`);
      return true;
    }

    sendError(res, 405, "method not allowed; use GET or POST");
    return true;
  };
}
