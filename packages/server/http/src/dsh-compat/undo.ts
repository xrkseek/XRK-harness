/**
 * dsh-undo-savepoint — file-backed settings rollback via host-settings.json snapshots.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { sendJson } from "./underlying/http-json.js";
import { dataPath, writeJsonFile } from "./underlying/json-store.js";
import { recordRewindFromGit } from "./turn-rewind-workspace.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface UndoSavepointOptions {
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
}

interface UndoSettings {
  auto: boolean;
  debounce: number;
  keepAuto: number;
  keepPre: number;
  autoCleanup: boolean;
  keep: number;
  manualDir: string;
  autoDir: string;
  sensitive: string;
  autoEnabled?: boolean;
  watchDebounceMs?: number;
}

interface SnapshotRow {
  id: string;
  time: string;
  type: string;
  location: string;
  label?: string;
  profile?: string;
  reason?: string;
}

interface RuntimeState {
  undoStack: string[];
  undoIndex: number;
  safeModeActive: boolean;
  lastGoodSnapshotId: string | null;
  bootAlert: boolean;
  lastExportPath: string | null;
}

const DEFAULT_SETTINGS: UndoSettings = {
  auto: true,
  debounce: 5000,
  keepAuto: 20,
  keepPre: 5,
  autoCleanup: true,
  keep: 20,
  manualDir: "",
  autoDir: "",
  sensitive: "redact",
  autoEnabled: true,
  watchDebounceMs: 5000,
};

const DEFAULT_RUNTIME: RuntimeState = {
  undoStack: [],
  undoIndex: -1,
  safeModeActive: false,
  lastGoodSnapshotId: null,
  bootAlert: false,
  lastExportPath: null,
};

const UNDO_SETTINGS_STORE = createXrkDocStore(
  ["undo-savepoint", "settings.json"],
  { ...DEFAULT_SETTINGS },
);

const UNDO_INDEX_STORE = createXrkDocStore(
  ["undo-savepoint", "snapshots.json"],
  [] as SnapshotRow[],
);

const UNDO_RUNTIME_STORE = createXrkDocStore(
  ["undo-savepoint", "runtime.json"],
  { ...DEFAULT_RUNTIME },
);

function undoRoot(options: UndoSavepointOptions): string {
  return dataPath(options.xrkHome, "undo-savepoint");
}

function exportDir(options: UndoSavepointOptions): string {
  const dir = path.join(undoRoot(options), "exports");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function snapshotsDir(options: UndoSavepointOptions): string {
  const dir = path.join(undoRoot(options), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function loadSettings(options: UndoSavepointOptions): UndoSettings {
  return { ...DEFAULT_SETTINGS, ...UNDO_SETTINGS_STORE.read(options.xrkHome).data };
}

function saveSettings(options: UndoSavepointOptions, s: UndoSettings): number {
  return UNDO_SETTINGS_STORE.write(options.xrkHome, s).revision;
}

function loadIndex(options: UndoSavepointOptions): SnapshotRow[] {
  const rows = UNDO_INDEX_STORE.read(options.xrkHome).data;
  return Array.isArray(rows) ? rows : [];
}

function saveIndex(options: UndoSavepointOptions, rows: SnapshotRow[]): number {
  return UNDO_INDEX_STORE.write(options.xrkHome, rows).revision;
}

function loadRuntime(options: UndoSavepointOptions): RuntimeState {
  return { ...DEFAULT_RUNTIME, ...UNDO_RUNTIME_STORE.read(options.xrkHome).data };
}

function saveRuntime(options: UndoSavepointOptions, state: RuntimeState): number {
  return UNDO_RUNTIME_STORE.write(options.xrkHome, state).revision;
}

function hostSettingsPath(options: UndoSavepointOptions): string {
  return path.join(dataPath(options.xrkHome), "host-settings.json");
}

function snapshotFile(options: UndoSavepointOptions, id: string): string {
  return path.join(snapshotsDir(options), `${id}.json`);
}

function readJsonOrEmpty(file: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function hostSettingsSource(options: UndoSavepointOptions): string | null {
  const candidate = hostSettingsPath(options);
  return existsSync(candidate) ? candidate : null;
}

function createSnapshot(
  options: UndoSavepointOptions,
  type: string,
  extra: Partial<SnapshotRow> = {},
): SnapshotRow {
  const id = `snap-${Date.now()}`;
  const row: SnapshotRow = {
    id,
    time: new Date().toISOString(),
    type,
    location: type === "manual" ? "manual" : "auto",
    profile: "xrk",
    ...extra,
  };
  const src = hostSettingsSource(options);
  if (src) {
    try {
      copyFileSync(src, snapshotFile(options, id));
    } catch {
      /* metadata still listed */
    }
  }
  const rows = [row, ...loadIndex(options)];
  saveIndex(options, rows);
  const runtime = loadRuntime(options);
  runtime.lastGoodSnapshotId = id;
  saveRuntime(options, runtime);
  return row;
}

function restoreFromSnapshot(
  options: UndoSavepointOptions,
  id: string,
  pushHistory = true,
): { ok: boolean; unchanged?: boolean; error?: { message: string } } {
  const file = snapshotFile(options, id);
  if (!existsSync(file)) {
    return { ok: false, error: { message: `snapshot not found: ${id}` } };
  }
  const dest = hostSettingsPath(options);
  const current = readJsonOrEmpty(existsSync(dest) ? dest : "");
  const target = readJsonOrEmpty(file);
  const unchanged = JSON.stringify(current) === JSON.stringify(target);
  if (!unchanged) {
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }
  if (pushHistory) {
    const runtime = loadRuntime(options);
    const stack = runtime.undoStack.slice(0, runtime.undoIndex + 1);
    stack.push(id);
    saveRuntime(options, {
      ...runtime,
      undoStack: stack,
      undoIndex: stack.length - 1,
      lastGoodSnapshotId: id,
    });
  }
  return { ok: true, ...(unchanged ? { unchanged: true } : {}) };
}

function computeDiff(
  options: UndoSavepointOptions,
  id: string,
): Array<{ name: string; added: number; removed: number }> {
  const file = snapshotFile(options, id);
  const dest = hostSettingsPath(options);
  if (!existsSync(file)) return [];
  const a = JSON.stringify(readJsonOrEmpty(file), null, 2).split("\n");
  const b = JSON.stringify(
    readJsonOrEmpty(existsSync(dest) ? dest : ""),
    null,
    2,
  ).split("\n");
  const added = Math.max(0, a.length - b.length);
  const removed = Math.max(0, b.length - a.length);
  return [{ name: "host-settings.json", added, removed }];
}

function pruneSnapshots(options: UndoSavepointOptions): {
  removedAuto: number;
  removedPre: number;
} {
  const settings = loadSettings(options);
  const rows = loadIndex(options);
  const autoKeep = settings.keepAuto ?? DEFAULT_SETTINGS.keepAuto;
  const preKeep = settings.keepPre ?? DEFAULT_SETTINGS.keepPre;
  let removedAuto = 0;
  let removedPre = 0;
  const kept: SnapshotRow[] = [];
  const auto: SnapshotRow[] = [];
  const pre: SnapshotRow[] = [];
  for (const row of rows) {
    if (row.type === "manual" || row.type === "baseline") {
      kept.push(row);
      continue;
    }
    if (row.type === "pre-restore") pre.push(row);
    else auto.push(row);
  }
  const drop = (list: SnapshotRow[], limit: number, counter: "auto" | "pre") => {
    while (list.length > limit) {
      const victim = list.pop();
      if (!victim) break;
      try {
        unlinkSync(snapshotFile(options, victim.id));
      } catch {
        /* ignore */
      }
      if (counter === "auto") removedAuto += 1;
      else removedPre += 1;
    }
    return list;
  };
  if (settings.autoCleanup) {
    drop(auto, autoKeep, "auto");
    drop(pre, preKeep, "pre");
  }
  saveIndex(options, [...kept, ...pre, ...auto]);
  return { removedAuto, removedPre };
}

export async function handleUndoHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: UndoSavepointOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/api/undo")) return false;
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/api/undo/settings") {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, { ok: true, settings: loadSettings(options) });
      return true;
    }
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const next = { ...loadSettings(options), ...body };
      saveSettings(options, next);
      sendJson(res, 200, { ok: true, settings: next });
      return true;
    }
  }

  if (pathname === "/api/undo/status") {
    const rows = loadIndex(options);
    const runtime = loadRuntime(options);
    sendJson(res, 200, {
      ok: true,
      total: rows.length,
      ...(runtime.bootAlert
        ? {
            bootAlert: true,
            lastGoodSnapshotId: runtime.lastGoodSnapshotId,
          }
        : {}),
    });
    return true;
  }

  if (pathname === "/api/undo/list") {
    sendJson(res, 200, { ok: true, snapshots: loadIndex(options) });
    return true;
  }

  if (pathname === "/api/undo/snapshot" && method === "POST") {
    const body = await parseJsonBody(req);
    const reason =
      typeof body.reason === "string" ? body.reason : "manual:ui";
    const row = createSnapshot(options, "manual", { reason });
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const messageSeq =
      typeof body.messageSeq === "number" ? body.messageSeq : 0;
    const cwd =
      (typeof body.cwd === "string" && body.cwd.trim()
        ? body.cwd.trim()
        : undefined) ?? options.workspaceRoot;
    if (sessionId && messageSeq > 0 && cwd) {
      recordRewindFromGit({
        ...(options.xrkHome ? { xrkHome: options.xrkHome } : {}),
        sessionId,
        messageSeq,
        cwd,
        checkpointId: row.id,
      });
    }
    sendJson(res, 200, { ok: true, id: row.id, snapshot: row });
    return true;
  }

  if (pathname.startsWith("/api/undo/diff")) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const id = url.searchParams.get("id") ?? "";
    sendJson(res, 200, { ok: true, diff: computeDiff(options, id) });
    return true;
  }

  if (pathname === "/api/undo/pick-dir" && method === "POST") {
    const dir = exportDir(options);
    sendJson(res, 200, { ok: true, path: dir });
    return true;
  }

  if (pathname === "/api/undo/pick-file" && method === "POST") {
    const runtime = loadRuntime(options);
    const dir = exportDir(options);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const pick =
      runtime.lastExportPath && existsSync(runtime.lastExportPath)
        ? runtime.lastExportPath
        : files.length > 0
          ? path.join(dir, files[files.length - 1]!)
          : "";
    if (!pick) {
      sendJson(res, 200, { ok: false, error: { message: "no export bundle found" } });
      return true;
    }
    sendJson(res, 200, { ok: true, path: pick });
    return true;
  }

  if (pathname === "/api/undo/restore" && (method === "POST" || method === "PUT")) {
    const body = await parseJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    createSnapshot(options, "pre-restore");
    const result = restoreFromSnapshot(options, id, true);
    if (!result.ok) {
      sendJson(res, 200, { ok: false, error: result.error });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      needsRestart: !result.unchanged,
      message: result.unchanged ? "unchanged" : undefined,
    });
    return true;
  }

  if (pathname === "/api/undo/undo" && (method === "POST" || method === "PUT")) {
    const runtime = loadRuntime(options);
    if (runtime.undoIndex <= 0) {
      sendJson(res, 200, { ok: false, error: { message: "nothing to undo" } });
      return true;
    }
    const nextIndex = runtime.undoIndex - 1;
    const targetId = runtime.undoStack[nextIndex] ?? "";
    const result = restoreFromSnapshot(options, targetId, false);
    if (!result.ok) {
      sendJson(res, 200, { ok: false, error: result.error });
      return true;
    }
    saveRuntime(options, { ...runtime, undoIndex: nextIndex });
    sendJson(res, 200, {
      ok: true,
      targetId,
      ...(result.unchanged ? { unchanged: true } : {}),
    });
    return true;
  }

  if (pathname === "/api/undo/redo" && (method === "POST" || method === "PUT")) {
    const runtime = loadRuntime(options);
    if (runtime.undoIndex >= runtime.undoStack.length - 1) {
      sendJson(res, 200, { ok: false, error: { message: "nothing to redo" } });
      return true;
    }
    const nextIndex = runtime.undoIndex + 1;
    const targetId = runtime.undoStack[nextIndex] ?? "";
    const result = restoreFromSnapshot(options, targetId, false);
    if (!result.ok) {
      sendJson(res, 200, { ok: false, error: result.error });
      return true;
    }
    saveRuntime(options, { ...runtime, undoIndex: nextIndex });
    sendJson(res, 200, {
      ok: true,
      targetId,
      ...(result.unchanged ? { unchanged: true } : {}),
    });
    return true;
  }

  if (pathname === "/api/undo/remove" && (method === "POST" || method === "PUT")) {
    const body = await parseJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    const rows = loadIndex(options).filter((r) => r.id !== id);
    saveIndex(options, rows);
    try {
      unlinkSync(snapshotFile(options, id));
    } catch {
      /* ignore */
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/undo/prune" && (method === "POST" || method === "PUT")) {
    const counts = pruneSnapshots(options);
    sendJson(res, 200, { ok: true, ...counts });
    return true;
  }

  if (pathname === "/api/undo/export" && (method === "POST" || method === "PUT")) {
    const rows = loadIndex(options);
    const bundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      snapshots: rows,
    };
    const file = path.join(
      exportDir(options),
      `export-${Date.now()}.json`,
    );
    writeJsonFile(file, bundle);
    const runtime = loadRuntime(options);
    saveRuntime(options, { ...runtime, lastExportPath: file });
    const settings = loadSettings(options);
    sendJson(res, 200, {
      ok: true,
      count: rows.length,
      path: file,
      ...(settings.sensitive === "warn"
        ? { sensitiveWarning: true }
        : {}),
    });
    return true;
  }

  if (pathname === "/api/undo/import" && (method === "POST" || method === "PUT")) {
    const body = await parseJsonBody(req);
    const importPath = typeof body.path === "string" ? body.path : "";
    if (!importPath || !existsSync(importPath)) {
      sendJson(res, 200, {
        ok: false,
        error: { message: "import path not found" },
      });
      return true;
    }
    let imported = 0;
    let skipped = 0;
    try {
      const raw = JSON.parse(readFileSync(importPath, "utf8")) as {
        snapshots?: SnapshotRow[];
      };
      const incoming = raw.snapshots ?? [];
      const existing = new Set(loadIndex(options).map((r) => r.id));
      const merged = [...loadIndex(options)];
      for (const row of incoming) {
        if (!row?.id || existing.has(row.id)) {
          skipped += 1;
          continue;
        }
        merged.push(row);
        existing.add(row.id);
        imported += 1;
      }
      saveIndex(options, merged);
    } catch {
      sendJson(res, 200, { ok: false, error: { message: "invalid export bundle" } });
      return true;
    }
    sendJson(res, 200, { ok: true, imported, skipped });
    return true;
  }

  if (pathname === "/api/undo/safe-mode") {
    const runtime = loadRuntime(options);
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const action = typeof body.action === "string" ? body.action : "status";
      if (action === "on") {
        saveRuntime(options, { ...runtime, safeModeActive: true });
        sendJson(res, 200, { ok: true, active: true });
        return true;
      }
      if (action === "off") {
        saveRuntime(options, { ...runtime, safeModeActive: false });
        sendJson(res, 200, { ok: true, active: false });
        return true;
      }
      sendJson(res, 200, { ok: true, active: runtime.safeModeActive });
      return true;
    }
    sendJson(res, 200, { ok: true, active: runtime.safeModeActive });
    return true;
  }

  if (method === "POST" || method === "PUT") await parseJsonBody(req);
  sendJson(res, 200, { ok: false, path: pathname });
  return true;
}
