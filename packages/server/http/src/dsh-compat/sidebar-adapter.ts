/**
 * dsh-better-sidebar Host routes → XRK workspace FS (compat).
 * Primary: POST /sidebar/api/{method} · GET/POST /sidebar/upload · GET /sidebar/file
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, opendir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "./underlying/http-json.js";
import {
  gitBranches,
  gitCherryPick,
  gitCheckout,
  gitCommit,
  gitCommitDiff,
  gitDiff,
  gitDiscard,
  gitLog,
  gitRevert,
  gitStage,
  gitStatus,
  gitUnstage,
} from "./sidebar-git.js";
import {
  loadSidebarPrefs,
  saveSidebarPrefs,
} from "./sidebar-prefs-store.js";
import { probeBrowserUrl } from "./sidebar-browser.js";

import type { SidebarFaceBridge } from "./sidebar-face-bridge.js";

export interface SidebarCompatOptions {
  /** Resolve session workspace cwd (Face). */
  readonly resolveSessionCwd?: (sessionId: string) => string | undefined;
  /** Fallback when session unknown. */
  readonly defaultCwd?: string;
  readonly xrkHome?: string;
  /** Side Chat + open.external (Host injects from Face). */
  readonly sidebarFace?: SidebarFaceBridge;
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
): Promise<{ matches: string[]; truncated: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle || !existsSync(root)) {
    return { matches: [], truncated: false };
  }
  const rootResolved = path.resolve(root);
  const matches: string[] = [];
  const queue = [rootResolved];
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
        const rel = path.relative(rootResolved, full).replace(/\\/g, "/");
        matches.push(rel.startsWith("/") ? rel.slice(1) : rel);
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
          : typeof payload.count === "number" && payload.count > 0
            ? payload.count
            : 20;
      const skip =
        typeof payload.skip === "number" && payload.skip > 0
          ? payload.skip
          : 0;
      // Client expects a bare array.
      return ok(gitLog(cwd, limit, skip));
    }
    case "git.diff": {
      const filePath =
        typeof payload.path === "string" ? payload.path : undefined;
      return ok(gitDiff(cwd, filePath, payload.staged === true));
    }
    case "git.commit-diff": {
      const hash = typeof payload.hash === "string" ? payload.hash : "";
      return ok(gitCommitDiff(cwd, hash));
    }
    case "git.stage": {
      const filePath =
        typeof payload.path === "string" ? payload.path : undefined;
      return ok(gitStage(cwd, filePath));
    }
    case "git.unstage": {
      const filePath =
        typeof payload.path === "string" ? payload.path : undefined;
      return ok(gitUnstage(cwd, filePath));
    }
    case "git.commit": {
      const message =
        typeof payload.message === "string" ? payload.message : "";
      return ok(gitCommit(cwd, message));
    }
    case "git.checkout": {
      const branch = typeof payload.branch === "string" ? payload.branch : "";
      return ok(gitCheckout(cwd, branch));
    }
    case "git.discard": {
      const filePath = typeof payload.path === "string" ? payload.path : "";
      return ok(gitDiscard(cwd, filePath));
    }
    case "git.revert": {
      const hash = typeof payload.hash === "string" ? payload.hash : "";
      return ok(gitRevert(cwd, hash));
    }
    case "git.cherry-pick": {
      const hash = typeof payload.hash === "string" ? payload.hash : "";
      return ok(gitCherryPick(cwd, hash));
    }
    case "terminal.deps":
      // Repair panel reads command/profile/note when WS closes with pty-deps-missing.
      return ok({
        ready: true,
        ok: true,
        adapter: "xrk-host-pty",
        platform: process.platform,
        profile: null,
        command: "pnpm add -D node-pty@1.2.0-beta.15",
        note: "XRK Host serves /sidebar/ws/terminal via node-pty when the package is installable.",
      });
    case "jobs.output": {
      const bridge = options.sidebarFace;
      const jobId =
        typeof payload.jobId === "string"
          ? payload.jobId
          : typeof payload.id === "string"
            ? payload.id
            : "";
      if (!bridge?.readJobOutput || !jobId) {
        return ok({ text: "", truncated: false });
      }
      return ok(bridge.readJobOutput(jobId));
    }
    case "jobs.kill": {
      const bridge = options.sidebarFace;
      const jobId =
        typeof payload.jobId === "string"
          ? payload.jobId
          : typeof payload.id === "string"
            ? payload.id
            : "";
      const reason =
        typeof payload.reason === "string" ? payload.reason : undefined;
      if (!bridge?.killJob || !jobId) {
        return ok({ ok: false, killed: false, reason: "no-background-job-host" });
      }
      return ok(await bridge.killJob(jobId, reason));
    }
    case "subagents.live": {
      const bridge = options.sidebarFace;
      const rootSessionId =
        typeof payload.rootSessionId === "string"
          ? payload.rootSessionId.trim()
          : "";
      if (!bridge?.listSubagentsLive || !rootSessionId) {
        return ok({ live: {} });
      }
      return ok(await bridge.listSubagentsLive(rootSessionId));
    }
    case "browser.probe": {
      const rawUrl =
        typeof payload.url === "string"
          ? payload.url
          : typeof payload.href === "string"
            ? payload.href
            : "";
      return ok(await probeBrowserUrl(rawUrl));
    }
    case "pty.close":
    case "agent-pty.close":
      // PTY lifecycle is WS-driven; explicit close is best-effort ack.
      return ok({ closed: true });
    case "open.external": {
      const bridge = options.sidebarFace;
      if (!bridge) {
        return fail("unavailable", "open.external requires XRK Host Face bridge");
      }
      const action = payload.action === "url" ? "url" : "reveal";
      const pathValue =
        typeof payload.path === "string" ? payload.path : undefined;
      const urlValue = typeof payload.url === "string" ? payload.url : undefined;
      await bridge.openExternal({
        action,
        ...(pathValue ? { path: pathValue } : {}),
        ...(urlValue ? { url: urlValue } : {}),
      });
      return ok({ opened: true });
    }
    case "sidechat.start": {
      const bridge = options.sidebarFace;
      const parent =
        typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
      if (!bridge || !parent) {
        return fail("unavailable", "sidechat requires XRK Host Face bridge");
      }
      const question =
        typeof payload.question === "string" ? payload.question : "";
      return ok(await bridge.startSidechat(parent, question));
    }
    case "sidechat.prompt": {
      const bridge = options.sidebarFace;
      const childId =
        typeof payload.childId === "string" ? payload.childId.trim() : "";
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!bridge || !childId || !text.trim()) {
        return fail("invalid-payload", "childId and text required");
      }
      return ok(await bridge.promptSidechat(childId, text));
    }
    case "sidechat.cancel": {
      const bridge = options.sidebarFace;
      const childId =
        typeof payload.childId === "string" ? payload.childId.trim() : "";
      if (!bridge || !childId) {
        return fail("invalid-payload", "childId required");
      }
      return ok(await bridge.cancelSidechat(childId));
    }
    case "sidechat.dispose": {
      const bridge = options.sidebarFace;
      const childId =
        typeof payload.childId === "string" ? payload.childId.trim() : "";
      if (!bridge || !childId) {
        return fail("invalid-payload", "childId required");
      }
      return ok(await bridge.disposeSidechat(childId));
    }
    case "sidechat.info": {
      const bridge = options.sidebarFace;
      const childId =
        typeof payload.childId === "string" ? payload.childId.trim() : "";
      if (!bridge || !childId) {
        return fail("invalid-payload", "childId required");
      }
      return ok(await bridge.infoSidechat(childId));
    }
    default:
      return fail(
        "unsupported",
        `sidebar method "${method}" is not implemented on XRK`,
      );
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
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]?.trim();
    if (contentType === "application/octet-stream") {
      const sessionId = url.searchParams.get("sessionId") ?? undefined;
      const cwdOverride = url.searchParams.get("cwd") ?? undefined;
      const dir = url.searchParams.get("dir") ?? "";
      const relativePath = url.searchParams.get("relativePath") ?? "";
      const cwd = resolveCwd(options, sessionId, cwdOverride ?? undefined);
      const baseDir = path.isAbsolute(dir) ? path.resolve(dir) : safeJoin(cwd, dir);
      if (!baseDir) {
        sendJson(res, 200, fail("path", "dir escapes workspace"));
        return true;
      }
      const rel = relativePath.replace(/^[/\\]+/, "");
      const abs = safeJoin(baseDir, rel);
      if (!abs) {
        sendJson(res, 200, fail("path", "relativePath escapes workspace"));
        return true;
      }
      await mkdir(path.dirname(abs), { recursive: true });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        req.on("data", (c) => chunks.push(Buffer.from(c)));
        req.on("end", () => resolve());
        req.on("error", reject);
      });
      await writeFile(abs, Buffer.concat(chunks));
      sendJson(res, 200, ok({ uploaded: true, path: abs }));
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
