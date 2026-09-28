/**
 * `/api/michengai/<pkg>/update|check` — shared update-probe for MiChengAI packs.
 * Previously dumped into im-connect empty channels (wrong).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface MichengaiOptions {
  readonly xrkHome?: string;
}

interface ScheduleTask {
  id: string;
  name: string;
  prompt: string;
  scheduleKind: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface MichengaiDoc {
  schedules: ScheduleTask[];
  archives: unknown[];
  agents: unknown[];
}

const STORE = createXrkDocStore<MichengaiDoc>(["dsh-michengai", "state.json"], {
  schedules: [],
  archives: [],
  agents: [],
});

function updateProbe(packageName: string): Record<string, unknown> {
  return {
    ok: true,
    packageName,
    current: null,
    latest: null,
    updateAvailable: false,
    checkedAt: Date.now(),
    adapter: DSH_COMPAT_ADAPTER,
    note: "XRK update probe; install/update via dshmarket / xrkh plugin.",
  };
}

export function isMichengaiPath(pathname: string): boolean {
  return (
    pathname === "/api/michengai" || pathname.startsWith("/api/michengai/")
  );
}

/** True for im-connect nested under michengai — leave to im-connect handler. */
export function isMichengaiImConnectPath(pathname: string): boolean {
  return (
    pathname === "/api/michengai/dsh-im-connect" ||
    pathname.startsWith("/api/michengai/dsh-im-connect/")
  );
}

export async function handleMichengaiHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: MichengaiOptions = {},
): Promise<boolean> {
  if (!isMichengaiPath(pathname) || isMichengaiImConnectPath(pathname)) {
    return false;
  }
  const method = httpMethod(req);
  const parts = pathname.split("/").filter(Boolean);
  // /api/michengai/<pkg>/...
  const pkg = parts[2] ?? "";
  const action = parts[3] ?? "";
  const xrkHome = options.xrkHome;

  if (action === "update" || action === "check" || action === "version") {
    if (method === "POST" || method === "PUT") await parseJsonBody(req);
    const packageName = pkg ? `@michengai/${pkg}` : "unknown";
    sendJson(res, 200, updateProbe(packageName));
    return true;
  }

  // Automation schedule catalog
  if (pkg === "dsh-automation" || pkg === "automation") {
    if (action === "tasks" || action === "schedules" || action === "") {
      if (method === "GET" || method === "HEAD") {
        sendJson(res, 200, {
          ok: true,
          tasks: STORE.read(xrkHome).data.schedules,
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      if (method === "POST") {
        const body = await parseJsonBody(req);
        const now = new Date().toISOString();
        const id =
          typeof body.id === "string" && body.id
            ? body.id
            : `sched-${Date.now()}`;
        const task: ScheduleTask = {
          id,
          name: typeof body.name === "string" ? body.name : "Untitled",
          prompt: typeof body.prompt === "string" ? body.prompt : "",
          scheduleKind:
            typeof body.scheduleKind === "string"
              ? body.scheduleKind
              : "daily",
          enabled: body.enabled !== false,
          createdAt: now,
          updatedAt: now,
          ...body,
        };
        STORE.patch(xrkHome, (doc) => ({
          ...doc,
          schedules: [...doc.schedules.filter((t) => t.id !== id), task],
        }));
        sendJson(res, 200, {
          ok: true,
          task,
          tasks: STORE.read(xrkHome).data.schedules,
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
    }
  }

  // Archive manager list
  if (pkg === "dsh-archive-manager" || pkg === "archive-manager") {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, {
        ok: true,
        archives: STORE.read(xrkHome).data.archives,
        items: STORE.read(xrkHome).data.archives,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      STORE.patch(xrkHome, (doc) => ({
        ...doc,
        archives: [body, ...doc.archives].slice(0, 200),
      }));
      sendJson(res, 200, {
        ok: true,
        archives: STORE.read(xrkHome).data.archives,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  // Agency agents catalog
  if (pkg === "dsh-agency-agents" || pkg === "agency-agents") {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, {
        ok: true,
        agents: STORE.read(xrkHome).data.agents,
        items: STORE.read(xrkHome).data.agents,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      STORE.patch(xrkHome, (doc) => ({
        ...doc,
        agents: [body, ...doc.agents].slice(0, 200),
      }));
      sendJson(res, 200, {
        ok: true,
        agents: STORE.read(xrkHome).data.agents,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }
  sendJson(res, 200, {
    ok: true,
    path: pathname,
    package: pkg || null,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
