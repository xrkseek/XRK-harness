/**
 * dsh-tongflow canvas-compat API (`/api/task/*`, `/api/plugins/registry`, …).
 * Studio routes under `/tongflow/*` return honest offline shells when Python TongFlow is absent.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { readBody, sendJson } from "./underlying/http-json.js";
import {
  readXrkPluginInventory,
  type XrkPluginServicesOptions,
} from "../xrk/plugin-services.js";
import { dataPath } from "./underlying/json-store.js";
import { honestReady } from "./honest-envelope.js";
import { scanTongflowRegistryFromInventory } from "./host-feature-bridge.js";
import {
  tryPythonTongflowScan,
  tongflowPythonStatus,
} from "./tongflow-python-bridge.js";
import {
  executeTongflowNode,
  mergeTongflowRegistry,
} from "./tongflow-node-runtime.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface TongflowOptions extends XrkPluginServicesOptions {
  readonly workspaceRoot?: string;
}

interface TaskRow {
  id: string;
  status: string;
  nodeId?: string;
  config: Record<string, unknown>;
  createdAt: string;
  data?: unknown;
}

interface TaskStore {
  tasks: Record<string, TaskRow>;
}

interface ProjectRow {
  id: string;
  name: string;
  updatedAt: string;
}

interface ProjectStore {
  projects: ProjectRow[];
}

const TASK_STORE = createXrkDocStore<TaskStore>(
  ["tongflow", "tasks.json"],
  { tasks: {} },
);

const PROJECT_STORE = createXrkDocStore<ProjectStore>(
  ["tongflow", "projects.json"],
  { projects: [] },
);

function loadTasks(options: TongflowOptions): TaskStore {
  return TASK_STORE.read(options.xrkHome).data;
}

function saveTasks(options: TongflowOptions, store: TaskStore): number {
  return TASK_STORE.write(options.xrkHome, store).revision;
}

function tongflowRoot(options: TongflowOptions): string {
  return dataPath(options.xrkHome, "tongflow");
}

function materialDir(options: TongflowOptions): string {
  const dir = path.join(tongflowRoot(options), "material");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function uploadDir(options: TongflowOptions): string {
  const dir = path.join(tongflowRoot(options), "uploads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function loadProjects(options: TongflowOptions): ProjectStore {
  return PROJECT_STORE.read(options.xrkHome).data;
}

function saveProjects(options: TongflowOptions, store: ProjectStore): number {
  return PROJECT_STORE.write(options.xrkHome, store).revision;
}

function emptyRegistry(): Record<string, unknown> {
  return {
    plugins: {},
    nodePluginMap: {},
    official: [],
    adapter: DSH_COMPAT_ADAPTER,
    note: "TongFlow Python scanner not embedded; canvas registry is empty on XRK.",
  };
}

function buildRegistry(options: TongflowOptions): Record<string, unknown> {
  const inv = readXrkPluginInventory(options);
  if (inv.present.length === 0) return emptyRegistry();
  const plugins: Record<string, unknown> = {};
  for (const name of inv.present) {
    const meta = inv.installedMap[name];
    plugins[name] = {
      name,
      version: meta?.version ?? "0.0.0",
      methodsByNodeSlot: {},
    };
  }
  return {
    plugins,
    nodePluginMap: {},
    official: [],
    adapter: DSH_COMPAT_ADAPTER,
  };
}

function mintTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function completeTask(
  options: TongflowOptions,
  taskId: string,
  nodeId?: string,
): TaskRow | undefined {
  const store = loadTasks(options);
  const row = store.tasks[taskId];
  if (!row) return undefined;
  const executed = executeTongflowNode(nodeId ?? row.nodeId, row.config, {
    ...(options.xrkHome ? { xrkHome: options.xrkHome } : {}),
  });
  row.status = executed.ok ? "COMPLETED" : "FAILED";
  if (nodeId) row.nodeId = nodeId;
  row.data = {
    result: executed.data,
    nodeId: executed.nodeId,
    engine: executed.engine,
    adapter: DSH_COMPAT_ADAPTER,
  };
  saveTasks(options, store);
  return row;
}

function writeSse(
  res: ServerResponse,
  payload: Record<string, unknown>,
): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function handleTongflowCanvasHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: TongflowOptions,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      status: "ok",
      adapter: DSH_COMPAT_ADAPTER,
      python: false,
    });
    return true;
  }

  if (pathname === "/plugins/install" && method === "POST") {
    const body = await parseJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      accepted: true,
      spec: typeof body.spec === "string" ? body.spec : "",
      adapter: DSH_COMPAT_ADAPTER,
      note: "Use xrk-harness plugin add for XRK inventory installs.",
    });
    return true;
  }

  if (pathname === "/api/plugins/registry") {
    sendJson(res, 200, mergeTongflowRegistry(buildRegistry(options)));
    return true;
  }

  if (pathname === "/api/users") {
    sendJson(res, 200, { users: [], adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (pathname.startsWith("/api/material")) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (method === "DELETE") {
      const id = path.basename(url.searchParams.get("id") ?? "");
      const abs = path.join(materialDir(options), id);
      if (existsSync(abs)) {
        try {
          unlinkSync(abs);
        } catch {
          /* ignore */
        }
      }
      sendJson(res, 200, { ok: true });
      return true;
    }
    const type = url.searchParams.get("type");
    const dir = materialDir(options);
    const items: unknown[] = [];
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      try {
        const st = statSync(abs);
        if (!st.isFile()) continue;
        const row = {
          id: name,
          name: path.parse(name).name,
          type: type ?? "asset",
          bytes: st.size,
          url: `/api/material/file?name=${encodeURIComponent(name)}`,
        };
        items.push(row);
      } catch {
        /* skip */
      }
    }
    sendJson(res, 200, { items, adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (pathname.startsWith("/api/material/file")) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const name = url.searchParams.get("name") ?? "";
    const safe = path.basename(name);
    const abs = path.join(materialDir(options), safe);
    if (!existsSync(abs)) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }
    const data = readFileSync(abs);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(data.length),
    });
    res.end(data);
    return true;
  }

  if (pathname === "/api/task/create" && method === "POST") {
    const body = await parseJsonBody(req);
    const taskId = mintTaskId();
    const nodeId =
      typeof body.nodeId === "string" ? body.nodeId : undefined;
    const store = loadTasks(options);
    store.tasks[taskId] = {
      id: taskId,
      status: "PENDING",
      ...(nodeId ? { nodeId } : {}),
      config: body,
      createdAt: new Date().toISOString(),
    };
    const revision = saveTasks(options, store);
    sendJson(res, 200, { taskId, revision, adapter: DSH_COMPAT_ADAPTER });
    return true;
  }

  if (pathname === "/api/task/update-status" && method === "POST") {
    const body = await parseJsonBody(req);
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const status = typeof body.status === "string" ? body.status : "COMPLETED";
    const store = loadTasks(options);
    const row = store.tasks[taskId];
    if (row) {
      row.status = status;
      saveTasks(options, store);
    }
    sendJson(res, 200, { ok: true, taskId, status });
    return true;
  }

  if (pathname === "/api/task/stop" && method === "POST") {
    const body = await parseJsonBody(req);
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const store = loadTasks(options);
    const row = store.tasks[taskId];
    if (row) {
      row.status = "CANCELLED";
      saveTasks(options, store);
    }
    sendJson(res, 200, { ok: true, taskId });
    return true;
  }

  if (pathname.startsWith("/api/task/wait")) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const taskId = url.searchParams.get("taskId") ?? "";
    const store = loadTasks(options);
    const row = store.tasks[taskId];
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    if (!row) {
      writeSse(res, { id: taskId, status: "FAILED", nodeId: null, data: "unknown task" });
      res.end();
      return true;
    }
    writeSse(res, { id: taskId, status: "SSE_CONNECTED", nodeId: row.nodeId ?? null });
    const done = completeTask(options, taskId, row.nodeId);
    writeSse(res, {
      id: taskId,
      status: "COMPLETED",
      nodeId: done?.nodeId ?? row.nodeId ?? null,
      data: done?.data ?? row.config,
    });
    res.end();
    return true;
  }

  if (pathname === "/api/upload" && method === "POST") {
    const raw = await readBody(req);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const name =
      url.searchParams.get("name")?.trim() ||
      `upload-${Date.now()}`;
    const safe = path.basename(name);
    const dest = path.join(uploadDir(options), safe);
    writeFileSync(dest, raw);
    const fileKey = safe;
    sendJson(res, 200, {
      ok: true,
      file_key: fileKey,
      url: `/api/upload/file?key=${encodeURIComponent(fileKey)}`,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname.startsWith("/api/upload/file")) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const key = path.basename(url.searchParams.get("key") ?? "");
    const abs = path.join(uploadDir(options), key);
    if (!existsSync(abs)) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }
    const data = readFileSync(abs);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(data.length),
    });
    res.end(data);
    return true;
  }

  return false;
}

export async function handleTongflowStudioHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: TongflowOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/tongflow/")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await readBody(req);
  }

  if (pathname === "/tongflow/health") {
    const py = tongflowPythonStatus(options.xrkHome);
    sendJson(res, 200, {
      ok: true,
      python: py.configured === true,
      scanner: py.configured === true,
      pythonBridge: py,
      connection: {
        mode: "http-bridge",
        stream: false,
        note: "XRK TypeScript node runtime + optional user Python bridge",
      },
      adapter: DSH_COMPAT_ADAPTER,
      note: "TongFlow studio engine not embedded; canvas-compat /api/* is file-backed.",
    });
    return true;
  }

  if (pathname === "/tongflow/connection" || pathname === "/tongflow/events") {
    sendJson(res, 200, {
      ok: true,
      connected: true,
      transport: "http-poll",
      endpoints: {
        health: "/tongflow/health",
        scan: "/tongflow/scan",
        tasks: "/api/task/create",
      },
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/tongflow/env" || pathname === "/tongflow/plugins") {
    sendJson(res, 200, {
      ok: true,
      registry: buildRegistry(options),
      env: {},
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/tongflow/projects" || pathname.startsWith("/tongflow/projects")) {
    sendJson(res, 200, {
      ok: true,
      projects: loadProjects(options).projects,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/tongflow/scan" || pathname.startsWith("/tongflow/scan")) {
    const pythonScan = tryPythonTongflowScan(
      options.workspaceRoot,
      process.env,
      options.xrkHome,
    );
    const inventory = readXrkPluginInventory(options);
    const registry = mergeTongflowRegistry(
      pythonScan ?? scanTongflowRegistryFromInventory(inventory.packages),
    );
    sendJson(res, 200, {
      ok: true,
      registry,
      scanner: registry.scanner ?? "typescript-runtime",
      python: registry.python === true,
      runtime: registry.runtime ?? "xrk-typescript",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  sendJson(res, 200, {
    ok: true,
    path: pathname,
    ...honestReady(),
    note: "TongFlow studio route acknowledged; full Python studio not hosted on XRK.",
  });
  return true;
}

export function isTongflowCanvasPath(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname === "/plugins" ||
    pathname === "/plugins/install" ||
    pathname === "/api/plugins/registry" ||
    pathname === "/api/users" ||
    pathname === "/api/material" ||
    pathname.startsWith("/api/material") ||
    pathname === "/api/task/create" ||
    pathname === "/api/task/update-status" ||
    pathname === "/api/task/stop" ||
    pathname.startsWith("/api/task/wait") ||
    pathname === "/api/upload" ||
    pathname.startsWith("/api/upload/")
  );
}

export function isTongflowStudioPath(pathname: string): boolean {
  return pathname.startsWith("/tongflow/");
}

export function isTongflowMiscPath(pathname: string): boolean {
  return (
    pathname === "/projects" ||
    pathname.startsWith("/projects/") ||
    pathname === "/Looks" ||
    pathname.startsWith("/Looks/") ||
    pathname === "/Materials" ||
    pathname.startsWith("/Materials/")
  );
}

function looksDir(options: TongflowOptions): string {
  const dir = path.join(tongflowRoot(options), "looks");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function materialsDir(options: TongflowOptions): string {
  const dir = path.join(tongflowRoot(options), "materials");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function listDirItems(dir: string, urlPrefix: string): unknown[] {
  const items: unknown[] = [];
  if (!existsSync(dir)) return items;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    try {
      const st = statSync(abs);
      items.push({
        id: name,
        name: path.parse(name).name,
        isDir: st.isDirectory(),
        bytes: st.isFile() ? st.size : 0,
        url: `${urlPrefix}/${encodeURIComponent(name)}`,
      });
    } catch {
      /* skip */
    }
  }
  return items;
}

export async function handleTongflowMiscHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: TongflowOptions,
): Promise<boolean> {
  if (!isTongflowMiscPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const body =
    method === "POST" || method === "PUT" || method === "PATCH"
      ? await parseJsonBody(req)
      : {};

  if (pathname === "/projects" || pathname.startsWith("/projects/")) {
    if (method === "POST" && pathname === "/projects") {
      const store = loadProjects(options);
      const row: ProjectRow = {
        id: `proj-${Date.now()}`,
        name:
          typeof body.name === "string" && body.name.trim()
            ? body.name.trim()
            : "project",
        updatedAt: new Date().toISOString(),
      };
      const revision = saveProjects(options, {
        projects: [row, ...store.projects],
      });
      sendJson(res, 201, {
        ok: true,
        project: row,
        revision,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    const store = loadProjects(options);
    sendJson(res, 200, {
      ok: true,
      projects: store.projects,
      adapter: DSH_COMPAT_ADAPTER,
      note: "TongFlow studio projects are file-backed on XRK.",
    });
    return true;
  }

  if (pathname === "/Looks" || pathname.startsWith("/Looks/")) {
    sendJson(res, 200, {
      ok: true,
      items: listDirItems(looksDir(options), "/Looks"),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/Materials" || pathname.startsWith("/Materials/")) {
    sendJson(res, 200, {
      ok: true,
      items: listDirItems(materialsDir(options), "/Materials"),
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  return false;
}
