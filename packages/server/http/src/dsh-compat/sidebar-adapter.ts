/**
 * dsh-better-sidebar Host routes → XRK workspace FS (compat).
 * Primary: POST /sidebar/api/{method} · GET/POST /sidebar/upload · GET /sidebar/file
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, opendir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http-json.js";
import { gitBranches, gitLog, gitStatus } from "./sidebar-git.js";
import {
  loadSidebarPrefs,
  saveSidebarPrefs,
} from "./sidebar-prefs-store.js";

export interface SidebarCompatOptions {
  /** Resolve session workspace cwd (Face). */
  readonly resolveSessionCwd?: (sessionId: string) => string | undefined;
  /** Fallback when session unknown. */
  readonly defaultCwd?: string;
  readonly xrkHome?: string;
}

/** NUL / high ratio of non-text bytes → treat as binary for editor routing. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.byteLength, 8000);
  if (n === 0) return false;
  let weird = 0;
  for (let i = 0; i < n; i += 1) {
    const b = buf[i]!;
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32)) weird += 1;
  }
  return weird / n > 0.3;
}

function ok(value: unknown): unknown {
  return { ok: true, value };
}

function fail(code: string, message: string): unknown {
  return { ok: false, error: { code, message } };
}

function resolveCwd(
  options: SidebarCompatOptions,
  sessionId: string | undefined,
  override?: string,
): string {
  if (typeof override === "string" && override.trim()) {
    return path.resolve(override.trim());
  }
  if (sessionId && options.resolveSessionCwd) {
    const mapped = options.resolveSessionCwd(sessionId);
    if (mapped) return path.resolve(mapped);
  }
  return path.resolve(options.defaultCwd ?? process.cwd());
}

function safeJoin(root: string, rel: string): string | undefined {
  const target = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (
    target !== rootResolved &&
    !target.startsWith(rootResolved + path.sep)
  ) {
    return undefined;
  }
  return target;
}

async function listTree(
  absDir: string,
): Promise<{ entries: Array<Record<string, unknown>> }> {
  const entries: Array<Record<string, unknown>> = [];
  if (!existsSync(absDir)) return { entries };
  const dir = await opendir(absDir);
  for await (const dent of dir) {
    const full = path.join(absDir, dent.name);
    let isDir = dent.isDirectory();
    let isSymlink = dent.isSymbolicLink();
    let broken = false;
    try {
      const st = statSync(full);
      isDir = st.isDirectory();
      isSymlink = st.isSymbolicLink();
    } catch {
      broken = true;
    }
    entries.push({
      name: dent.name,
      path: full,
      isDir,
      ...(isSymlink ? { isSymlink: true } : {}),
      ...(dent.name.startsWith(".") ? { hidden: true } : {}),
      ...(broken ? { broken: true } : {}),
    });
  }
  entries.sort((a, b) => {
    if (Boolean(a.isDir) !== Boolean(b.isDir)) return a.isDir ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
  return { entries };
}

async function searchFiles(
  root: string,
  query: string,
  limit = 200,
): Promise<{ matches: Array<{ path: string; name: string }>; truncated: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle || !existsSync(root)) {
    return { matches: [], truncated: false };
  }
  const matches: Array<{ path: string; name: string }> = [];
  const queue = [root];
  let truncated = false;
  while (queue.length > 0 && matches.length < limit) {
    const dir = queue.shift()!;
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      continue;
    }
    for await (const dent of handle) {
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
      const full = path.join(dir, dent.name);
      if (dent.name.toLowerCase().includes(needle)) {
        matches.push({ path: full, name: dent.name });
      }
      if (dent.isDirectory()) queue.push(full);
    }
  }
  if (queue.length > 0) truncated = true;
  return { matches, truncated };
}

async function dispatchMethod(
  method: string,
  payload: Record<string, unknown>,
  options: SidebarCompatOptions,
): Promise<unknown> {
  const sessionId =
    typeof payload.sessionId === "string" ? payload.sessionId : undefined;
  const cwdOverride =
    typeof payload.cwd === "string" ? payload.cwd : undefined;
  const cwd = resolveCwd(options, sessionId, cwdOverride);

  switch (method) {
    case "session.cwd":
      return ok({ cwd });
    case "fs.tree": {
      const rel =
        typeof payload.path === "string" && payload.path.trim()
          ? payload.path.trim()
          : cwd;
      const abs = path.isAbsolute(rel) ? path.resolve(rel) : safeJoin(cwd, rel);
      if (!abs) return fail("path", "path escapes workspace");
      return ok(await listTree(abs));
    }
    case "fs.search": {
      const query = typeof payload.query === "string" ? payload.query : "";
      const rel =
        typeof payload.path === "string" && payload.path.trim()
          ? payload.path.trim()
          : cwd;
      const abs = path.isAbsolute(rel) ? path.resolve(rel) : safeJoin(cwd, rel);
      if (!abs) return fail("path", "path escapes workspace");
      const limit =
        typeof payload.limit === "number" && payload.limit > 0
          ? Math.min(payload.limit, 500)
          : 200;
      return ok(await searchFiles(abs, query, limit));
    }
    case "fs.read": {
      const rel = typeof payload.path === "string" ? payload.path : "";
      const abs = path.isAbsolute(rel) ? path.resolve(rel) : safeJoin(cwd, rel);
      if (!abs || !existsSync(abs)) return fail("not-found", "file missing");
      // better-sidebar TextEditor expects `{ kind: "text"|"binary", content?, head?, truncated }`.
      // Returning only `{ content }` leaves `kind !== "text"` → empty editor pane.
      const buf = await readFile(abs);
      const truncated = buf.byteLength > 2_000_000;
      const slice = truncated ? buf.subarray(0, 2_000_000) : buf;
      if (looksBinary(slice)) {
        return ok({
          kind: "binary",
          truncated,
          head: slice.subarray(0, Math.min(512, slice.byteLength)).toString("base64"),
        });
      }
      return ok({
        kind: "text",
        content: slice.toString("utf8"),
        truncated,
      });
    }
    case "fs.write": {
      const rel = typeof payload.path === "string" ? payload.path : "";
      const abs = path.isAbsolute(rel) ? path.resolve(rel) : safeJoin(cwd, rel);
      if (!abs) return fail("path", "path escapes workspace");
      const content =
        typeof payload.content === "string" ? payload.content : "";
      await writeFile(abs, content, "utf8");
      return ok({ written: true });
    }
    case "fs.mkdir": {
      const rel = typeof payload.path === "string" ? payload.path : "";
      const abs = path.isAbsolute(rel) ? path.resolve(rel) : safeJoin(cwd, rel);
      if (!abs) return fail("path", "path escapes workspace");
      await mkdir(abs, { recursive: payload.recursive !== false });
      return ok({ created: true, path: abs });
    }
    case "fs.delete": {
      const rel = typeof payload.path === "string" ? payload.path : "";
      const abs = path.isAbsolute(rel) ? path.resolve(rel) : safeJoin(cwd, rel);
      if (!abs || !existsSync(abs)) return fail("not-found", "path missing");
      await unlink(abs);
      return ok({ deleted: true });
    }
    case "fs.stat": {
      const rel = typeof payload.path === "string" ? payload.path : "";
      const abs = path.isAbsolute(rel) ? path.resolve(rel) : safeJoin(cwd, rel);
      if (!abs || !existsSync(abs)) return fail("not-found", "path missing");
      const st = statSync(abs);
      return ok({
        path: abs,
        isDir: st.isDirectory(),
        isFile: st.isFile(),
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    }
    case "ping":
      return ok({ pong: true, adapter: "xrk-dsh-compat" });
    case "settings.get": {
      const row = loadSidebarPrefs(options.xrkHome);
      return ok({
        value: row.value,
        revision: row.revision,
        externalDisable: false,
      });
    }
    case "settings.update": {
      const row = loadSidebarPrefs(options.xrkHome);
      const patch =
        payload.patch && typeof payload.patch === "object"
          ? (payload.patch as Record<string, unknown>)
          : {};
      const value = { ...row.value, ...patch };
      const revision = row.revision + 1;
      saveSidebarPrefs(options.xrkHome, value, revision);
      return ok({ value, revision });
    }
    case "shell.get":
      return ok({
        shell: process.env.ComSpec || process.env.SHELL || "cmd.exe",
        displayName: "system",
      });
    case "git.status":
      return ok(gitStatus(cwd));
    case "git.branch":
      return ok(gitBranches(cwd));
    case "git.log": {
      const limit =
        typeof payload.limit === "number" && payload.limit > 0
          ? payload.limit
          : 20;
      return ok(gitLog(cwd, limit));
    }
    case "terminal.deps":
      // Interactive shell is `/sidebar/ws/terminal` on Host (node-pty).
      // If spawn fails the socket closes with reason `pty-deps-missing`.
      return ok({ ok: true, adapter: "xrk-host-pty" });
    case "jobs.output":
      return ok({ text: "", jobs: [] });
    case "subagents.live":
      return ok({ nodes: [] });
    case "browser.probe":
      return ok({
        ok: false,
        supported: false,
        reason: "embedded-browser-host-unavailable",
      });
    default:
      return ok({
        adapter: "xrk-dsh-compat",
        method,
        acknowledged: true,
      });
  }
}

export async function handleSidebarCompat(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: SidebarCompatOptions,
): Promise<boolean> {
  if (pathname.startsWith("/sidebar/api/")) {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, fail("method", "POST required"));
      return true;
    }
    const method = decodeURIComponent(pathname.slice("/sidebar/api/".length));
    const raw = await readBody(req);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw || "{}") as Record<string, unknown>;
    } catch {
      sendJson(res, 400, fail("bad-request", "invalid JSON"));
      return true;
    }
    try {
      const result = await dispatchMethod(method, payload, options);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(
        res,
        200,
        fail("http", err instanceof Error ? err.message : String(err)),
      );
    }
    return true;
  }

  if (pathname === "/sidebar/file") {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    const filePath = url.searchParams.get("path") ?? "";
    const cwdOverride = url.searchParams.get("cwd") ?? undefined;
    const cwd = resolveCwd(options, sessionId, cwdOverride ?? undefined);
    const abs = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : safeJoin(cwd, filePath);
    if (!abs || !existsSync(abs)) {
      sendJson(res, 404, fail("not-found", "file missing"));
      return true;
    }
    const download = url.searchParams.get("download") === "1";
    const st = statSync(abs);
    if (!st.isFile()) {
      sendJson(res, 400, fail("not-file", "not a file"));
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": st.size,
      ...(download
        ? {
            "content-disposition": `attachment; filename="${path.basename(abs)}"`,
          }
        : {}),
    });
    createReadStream(abs).pipe(res);
    return true;
  }

  if (pathname === "/sidebar/upload") {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, fail("method", "POST required"));
      return true;
    }
    const raw = await readBody(req);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw || "{}") as Record<string, unknown>;
    } catch {
      sendJson(res, 400, fail("bad-request", "invalid JSON"));
      return true;
    }
    const sessionId =
      typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    const cwdOverride =
      typeof payload.cwd === "string" ? payload.cwd : undefined;
    const cwd = resolveCwd(options, sessionId, cwdOverride);
    const rel = typeof payload.path === "string" ? payload.path : "";
    const abs = path.isAbsolute(rel) ? path.resolve(rel) : safeJoin(cwd, rel);
    if (!abs) {
      sendJson(res, 200, fail("path", "path escapes workspace"));
      return true;
    }
    const content =
      typeof payload.content === "string"
        ? payload.content
        : typeof payload.data === "string"
          ? Buffer.from(payload.data, "base64").toString("utf8")
          : "";
    await writeFile(abs, content, "utf8");
    sendJson(res, 200, ok({ uploaded: true, path: abs }));
    return true;
  }

  return false;
}
