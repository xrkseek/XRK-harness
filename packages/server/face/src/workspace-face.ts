/**
 * Face U2 workspace surface — real `@xrkseek/workspace` inject + product dir inventory.
 * No fake empty trees; path stays under workspaceRoot.
 */

import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  resolveWorkspaceInject,
} from "@xrkseek/workspace";
import type { FaceRuntime } from "./context.js";
import type { FaceRpcResult } from "./types.js";
import { resolveSessionCwd } from "./session-cwd.js";
import { canOpenNativePath } from "./host-open-path.js";
import { persistWorkspaceDoc } from "./workspace-store.js";

const MAX_LIST_ENTRIES = 200;
const MAX_LIST_DEPTH = 5;
const PREVIEW_CHARS = 160;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function resolveProductDir(root: string): string {
  // Workspace inject / skills stay under the project; user settings use resolveHarnessHome.
  return path.resolve(root, ".xrk");
}

function payloadSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const sessionId = (payload as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && sessionId.trim()
    ? sessionId.trim()
    : undefined;
}

/** Session cwd when `sessionId` is present; else Host serve root. */
export function resolveFaceWorkspaceRoot(
  runtime: FaceRuntime,
  payload?: unknown,
): string {
  const sessionId = payloadSessionId(payload);
  if (sessionId) return resolveSessionCwd(runtime, sessionId);
  return path.resolve(runtime.workspaceRoot);
}

/** Ensure candidate resolves under root (or equals root). */
export function assertUnderRoot(root: string, candidate: string): string {
  const base = path.resolve(root);
  const abs = path.resolve(candidate);
  const rel = path.relative(base, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathEscapeError(`path escapes workspace root: ${candidate}`);
  }
  return abs;
}

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

export interface WorkspaceProductEntry {
  readonly path: string;
  readonly kind: "file" | "dir";
  readonly bytes?: number;
}

export async function listProductTree(
  productDir: string,
  options?: { maxEntries?: number; maxDepth?: number },
): Promise<{
  readonly entries: WorkspaceProductEntry[];
  readonly truncated: boolean;
  readonly exists: boolean;
}> {
  const maxEntries = options?.maxEntries ?? MAX_LIST_ENTRIES;
  const maxDepth = options?.maxDepth ?? MAX_LIST_DEPTH;
  if (!(await exists(productDir))) {
    return { entries: [], truncated: false, exists: false };
  }
  const entries: WorkspaceProductEntry[] = [];
  let truncated = false;

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (truncated || depth > maxDepth) {
      if (depth > maxDepth) truncated = true;
      return;
    }
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const s = await stat(abs);
      if (s.isDirectory()) {
        entries.push({ path: childRel.replace(/\\/g, "/"), kind: "dir" });
        await walk(abs, childRel, depth + 1);
      } else if (s.isFile()) {
        entries.push({
          path: childRel.replace(/\\/g, "/"),
          kind: "file",
          bytes: s.size,
        });
      }
    }
  }

  await walk(productDir, "", 0);
  return { entries, truncated, exists: true };
}

function blockHeading(text: string): string {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (line.startsWith("## ")) return line.slice(3).trim();
  return line.slice(0, 48) || "(block)";
}

export async function workspaceDescribe(
  runtime: FaceRuntime,
  _rpcId?: string,
  payload?: unknown,
): Promise<FaceRpcResult<unknown>> {
  const root = resolveFaceWorkspaceRoot(runtime, payload);
  const productDir = resolveProductDir(root);
  const productExists = await exists(productDir);
  const agentsDir = path.join(root, ".agents");
  const agentsExists = await exists(agentsDir);
  return {
    ok: true,
    value: {
      root,
      productDir,
      productExists,
      canOpenPath: canOpenNativePath(),
      agentsDir,
      agentsExists,
    },
  };
}

export async function workspaceListProduct(
  runtime: FaceRuntime,
  _rpcId?: string,
  payload?: unknown,
): Promise<FaceRpcResult<unknown>> {
  const root = resolveFaceWorkspaceRoot(runtime, payload);
  const productDir = resolveProductDir(root);
  try {
    assertUnderRoot(root, productDir);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "path-escape",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  const listed = await listProductTree(productDir);
  return {
    ok: true,
    value: {
      productDir,
      exists: listed.exists,
      truncated: listed.truncated,
      entries: listed.entries,
    },
  };
}

export async function workspacePreviewInject(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const maxChars =
    typeof p.maxChars === "number" && p.maxChars > 0 ? p.maxChars : 32_000;
  const includeText = p.includeText === true;
  const root = resolveFaceWorkspaceRoot(runtime, payload);
  const productDir = resolveProductDir(root);
  try {
    assertUnderRoot(root, productDir);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "path-escape",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const resolved = await resolveWorkspaceInject({
    root,
    productDir,
    maxChars,
    ...(typeof p.displayTitle === "string" && p.displayTitle.trim()
      ? { displayTitle: p.displayTitle.trim() }
      : (() => {
          const sessionId = payloadSessionId(payload);
          if (!sessionId) return {};
          const wsId = runtime.workspaces.workspaceIdOf(sessionId);
          const title = wsId
            ? runtime.workspaces.get(wsId)?.title
            : undefined;
          return title?.trim() ? { displayTitle: title.trim() } : {};
        })()),
  });

  const blocks = resolved.blocks.map((text, index) => ({
    index,
    heading: blockHeading(text),
    chars: text.length,
    ...(includeText
      ? { preview: text.slice(0, PREVIEW_CHARS) }
      : {}),
  }));

  return {
    ok: true,
    value: {
      productDir,
      totalChars: resolved.blocks.reduce((n, b) => n + b.length, 0),
      blockCount: blocks.length,
      blocks,
      events: resolved.events,
    },
  };
}

/**
 * Face `workspace.list` — registry of workspaces + archived sessions.
 */
export async function workspaceListFace(
  runtime: FaceRuntime,
): Promise<FaceRpcResult<unknown>> {
  return {
    ok: true,
    value: runtime.workspaces.list(runtime.store.list()),
  };
}

export async function workspaceCreateFace(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const raw = typeof p.path === "string" ? p.path.trim() : "";
  if (!raw) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "path required" },
    };
  }
  const result = runtime.workspaces.create(raw);
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  runtime.bus.publishHost({
    type: "host/workspace-changed",
    workspace: result.workspace,
  });
  return { ok: true, value: result };
}

export async function workspaceRenameFace(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const workspaceId =
    typeof p.workspaceId === "string" ? p.workspaceId.trim() : "";
  const title = typeof p.title === "string" ? p.title : "";
  if (!workspaceId || !title.trim()) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "workspaceId and non-blank title required",
      },
    };
  }
  const workspace = runtime.workspaces.rename(workspaceId, title);
  if (!workspace) {
    return {
      ok: false,
      error: {
        code: "workspace-not-found",
        message: `unknown workspaceId: ${workspaceId}`,
      },
    };
  }
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  runtime.bus.publishHost({
    type: "host/workspace-changed",
    workspace,
  });
  return { ok: true, value: { workspace } };
}

export async function workspaceArchiveSessionFace(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const sessionId =
    typeof p.sessionId === "string" ? p.sessionId.trim() : "";
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  const archivedSessionIds = runtime.workspaces.archiveSession(sessionId);
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  runtime.bus.publishHost({
    type: "host/archived-sessions-changed",
    archivedSessionIds,
  });
  return { ok: true, value: { archivedSessionIds } };
}

export async function workspaceDeleteFace(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const workspaceId =
    typeof p.workspaceId === "string" ? p.workspaceId.trim() : "";
  if (!workspaceId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "workspaceId required" },
    };
  }
  const result = runtime.workspaces.delete(workspaceId);
  if (!result.ok) {
    if (result.reason.startsWith("unknown")) {
      return {
        ok: false,
        error: {
          code: "workspace-not-found",
          message: result.reason,
          details: { workspaceId },
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "internal",
        message: result.reason,
        details: {},
      },
    };
  }
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  runtime.bus.publishHost({
    type: "host/workspace-removed",
    workspaceId,
  });
  return {
    ok: true,
    value: { deleted: true as const },
  };
}

export async function workspaceInsertBeforeFace(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const workspaceId =
    typeof p.workspaceId === "string" ? p.workspaceId.trim() : "";
  const beforeId =
    typeof p.beforeId === "string"
      ? p.beforeId.trim()
      : typeof p.beforeWorkspaceId === "string"
        ? p.beforeWorkspaceId.trim()
        : "";
  if (!workspaceId || !beforeId) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "workspaceId and beforeId required",
      },
    };
  }
  const items = runtime.workspaces.insertBefore(workspaceId, beforeId);
  if (!items) {
    return {
      ok: false,
      error: {
        code: "workspace-not-found",
        message: "unknown workspaceId or beforeId",
      },
    };
  }
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  const listed = runtime.workspaces.list(runtime.store.list());
  runtime.bus.publishHost({
    type: "host/workspace-order-changed",
    workspaceIds: listed.items.map((w) => w.workspaceId),
  });
  return { ok: true, value: listed };
}

export async function workspaceInsertSessionBeforeFace(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const sessionId =
    typeof p.sessionId === "string" ? p.sessionId.trim() : "";
  const beforeSessionId =
    typeof p.beforeSessionId === "string" ? p.beforeSessionId.trim() : "";
  if (!sessionId || !beforeSessionId) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "sessionId and beforeSessionId required",
      },
    };
  }
  const workspace = runtime.workspaces.insertSessionBefore(
    sessionId,
    beforeSessionId,
  );
  if (!workspace) {
    return {
      ok: false,
      error: {
        code: "workspace-not-found",
        message: "session not in a live workspace",
      },
    };
  }
  runtime.bus.publishHost({
    type: "host/workspace-changed",
    workspace,
  });
  return { ok: true, value: { workspace } };
}
