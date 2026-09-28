/**
 * `@linxin666/dsh-client-ui-task-board` — persisted board under `~/.xrk/task-board/`.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface TaskBoardOptions {
  readonly xrkHome?: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  prompt: string;
  parentId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  executions: unknown[];
  workspaceId?: string;
  mode?: string;
  permission?: string;
  model?: string;
  tags?: string[];
  archived?: boolean;
}

interface BoardDoc {
  schemaVersion: number;
  revision: number;
  tasks: TaskRow[];
  sessionDefaultPermission: string;
  maxSubtaskDepth: number;
}

const STORE = createXrkDocStore<BoardDoc>(["task-board", "board.json"], {
  schemaVersion: 3,
  revision: 0,
  tasks: [],
  sessionDefaultPermission: "ask",
  maxSubtaskDepth: 3,
});

function snapshot(doc: BoardDoc): Record<string, unknown> {
  return {
    schemaVersion: doc.schemaVersion,
    revision: doc.revision,
    tasks: doc.tasks.filter((t) => !t.archived),
    scheduler: {
      timeZone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      ledgerId: "xrk-compat-task-board",
    },
    power: {
      platform: process.platform,
      phase: "disabled",
      enabled: false,
      sessionStateKnown: false,
      runningSessions: 0,
      armedSchedules: 0,
    },
    sessionDefaultPermission: doc.sessionDefaultPermission,
    maxSubtaskDepth: doc.maxSubtaskDepth,
    teamRunAvailable: false,
    adapter: DSH_COMPAT_ADAPTER,
  };
}

function bump(
  xrkHome: string | undefined,
  mutator: (tasks: TaskRow[], now: string) => TaskRow[],
): BoardDoc {
  const now = new Date().toISOString();
  return STORE.patch(xrkHome, (doc) => ({
    ...doc,
    revision: doc.revision + 1,
    tasks: mutator(doc.tasks, now),
  })).data;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function isTaskBoardPath(pathname: string): boolean {
  return (
    pathname === "/api/task-board" || pathname.startsWith("/api/task-board/")
  );
}

export async function handleTaskBoardHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: TaskBoardOptions = {},
): Promise<boolean> {
  if (!isTaskBoardPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;

  if (
    pathname === "/api/task-board" ||
    pathname === "/api/task-board/" ||
    pathname === "/api/task-board/state"
  ) {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, snapshot(STORE.read(xrkHome).data));
      return true;
    }
  }

  if (pathname === "/api/task-board/parse") {
    if (method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method-not-allowed" });
      return true;
    }
    const body = await parseJsonBody(req);
    const text = asString(body.text ?? body.prompt ?? body.input);
    const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
    sendJson(res, 200, {
      ok: true,
      draft: {
        title: firstLine.slice(0, 80) || "Untitled",
        description: text,
        prompt: text,
      },
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/task-board/action") {
    if (method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method-not-allowed" });
      return true;
    }
    const body = await parseJsonBody(req);
    const requestId =
      typeof body.requestId === "string" ? body.requestId : randomUUID();
    const action =
      body.action && typeof body.action === "object"
        ? (body.action as Record<string, unknown>)
        : body;
    const kind = asString(action.kind);

    if (kind === "create") {
      const input =
        action.input && typeof action.input === "object"
          ? (action.input as Record<string, unknown>)
          : action;
      const id =
        typeof action.id === "string" && action.id
          ? action.id
          : randomUUID();
      const title = asString(input.title).trim();
      if (!title) {
        sendJson(res, 200, {
          ok: false,
          error: "title is required",
          requestId,
          ...snapshot(STORE.read(xrkHome).data),
        });
        return true;
      }
      const doc = bump(xrkHome, (tasks, now) => [
        ...tasks,
        {
          id,
          title,
          description: asString(input.description),
          prompt: asString(input.prompt),
          ...(typeof input.parentId === "string"
            ? { parentId: input.parentId }
            : {}),
          status: "todo",
          createdAt: now,
          updatedAt: now,
          executions: [],
          ...(typeof input.workspaceId === "string"
            ? { workspaceId: input.workspaceId }
            : {}),
          ...(typeof input.mode === "string" ? { mode: input.mode } : {}),
          ...(typeof input.permission === "string"
            ? { permission: input.permission }
            : {}),
          ...(typeof input.model === "string" ? { model: input.model } : {}),
          tags: Array.isArray(input.tags)
            ? input.tags.filter((t): t is string => typeof t === "string")
            : [],
        },
      ]);
      sendJson(res, 200, { ok: true, requestId, ...snapshot(doc) });
      return true;
    }

    if (kind === "update") {
      const taskId = asString(action.taskId ?? action.id);
      const patch =
        action.patch && typeof action.patch === "object"
          ? (action.patch as Record<string, unknown>)
          : action;
      const doc = bump(xrkHome, (tasks, now) =>
        tasks.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            ...(typeof patch.title === "string" ? { title: patch.title } : {}),
            ...(typeof patch.description === "string"
              ? { description: patch.description }
              : {}),
            ...(typeof patch.prompt === "string"
              ? { prompt: patch.prompt }
              : {}),
            ...(typeof patch.status === "string"
              ? { status: patch.status }
              : {}),
            updatedAt: now,
          };
        }),
      );
      sendJson(res, 200, { ok: true, requestId, ...snapshot(doc) });
      return true;
    }

    if (kind === "move") {
      const taskId = asString(action.taskId ?? action.id);
      const status = asString(action.status, "todo");
      const doc = bump(xrkHome, (tasks, now) =>
        tasks.map((t) =>
          t.id === taskId ? { ...t, status, updatedAt: now } : t,
        ),
      );
      sendJson(res, 200, { ok: true, requestId, ...snapshot(doc) });
      return true;
    }

    if (kind === "archive") {
      const taskId = asString(action.taskId ?? action.id);
      const doc = bump(xrkHome, (tasks, now) =>
        tasks.map((t) =>
          t.id === taskId || t.parentId === taskId
            ? { ...t, archived: true, status: "archived", updatedAt: now }
            : t,
        ),
      );
      sendJson(res, 200, { ok: true, requestId, ...snapshot(doc) });
      return true;
    }

    if (kind === "delete") {
      const taskId = asString(action.taskId ?? action.id);
      const doc = bump(xrkHome, (tasks) =>
        tasks.filter((t) => t.id !== taskId && t.parentId !== taskId),
      );
      sendJson(res, 200, { ok: true, requestId, ...snapshot(doc) });
      return true;
    }

    if (kind === "import") {
      const incoming = Array.isArray(action.tasks) ? action.tasks : [];
      const doc = bump(xrkHome, (tasks, now) => {
        const next = [...tasks];
        for (const row of incoming) {
          if (!row || typeof row !== "object") continue;
          const t = row as Record<string, unknown>;
          const id = asString(t.id) || randomUUID();
          if (next.some((x) => x.id === id)) continue;
          next.push({
            id,
            title: asString(t.title, "Imported"),
            description: asString(t.description),
            prompt: asString(t.prompt),
            status: asString(t.status, "todo"),
            createdAt: asString(t.createdAt, now),
            updatedAt: now,
            executions: [],
          });
        }
        return next;
      });
      sendJson(res, 200, { ok: true, requestId, ...snapshot(doc) });
      return true;
    }

    if (kind === "run" || kind === "halt" || kind === "arm" || kind === "disarm") {
      sendJson(res, 200, {
        ok: false,
        error: "scheduler-unavailable",
        message:
          "Task run/schedule needs a Host runner; board mutations still persist.",
        requestId,
        ...snapshot(STORE.read(xrkHome).data),
      });
      return true;
    }

    sendJson(res, 200, {
      ok: false,
      error: `unknown-action:${kind || "missing"}`,
      requestId,
      ...snapshot(STORE.read(xrkHome).data),
    });
    return true;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }
  sendJson(res, 200, {
    ok: true,
    path: pathname,
    ...snapshot(STORE.read(xrkHome).data),
  });
  return true;
}
