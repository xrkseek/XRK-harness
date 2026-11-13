/**
 * Face `mcp.workspace.*` — read/write `{project}/.xrk/mcp.json`.
 * Mount of tools stays Xiangyang-only (Host); this API is config SoT for UI + AI.
 */

import {
  mcpServersForbiddenEnvMessage,
  parseMcpServersValue,
  readWorkspaceMcpFile,
  writeWorkspaceMcpFile,
  type McpServerRow,
} from "@xrkseek/server-config";
import type { FaceRuntime } from "./context.js";
import {
  isOrchestrationWorkspaceId,
  XIANGYANG_WORKSPACE_ID,
} from "./xiangyang-workspace.js";
import type { FaceRpcResult } from "./types.js";
import { asRecord } from "./handlers/types.js";

export type McpWorkspaceServerDraft = {
  readonly serverName: string;
  readonly command?: string;
  readonly url?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly cwdAllowWorkspace?: boolean;
};

function resolveProjectWorkspaceRoot(
  runtime: FaceRuntime,
  workspaceId: string,
): FaceRpcResult<{ readonly workspaceId: string; readonly path: string }> {
  const id = workspaceId.trim();
  if (!id) {
    return {
      ok: false,
      error: {
        code: "mcp-workspace-invalid",
        message: "workspaceId required",
      },
    };
  }
  if (isOrchestrationWorkspaceId(id)) {
    return {
      ok: false,
      error: {
        code: "mcp-workspace-reserved",
        message: `workspace ${id} is orchestration-only (no project .xrk/mcp.json)`,
      },
    };
  }
  const row = runtime.workspaces.get(id);
  const root = row?.path?.trim() ?? "";
  if (!row || !root) {
    return {
      ok: false,
      error: {
        code: "mcp-workspace-missing",
        message: `workspace ${id} not found or has no path`,
      },
    };
  }
  return { ok: true, value: { workspaceId: id, path: root } };
}

function draftsFromRows(
  rows: readonly McpServerRow[],
): McpWorkspaceServerDraft[] {
  return rows.map((row) => ({
    serverName: row.serverName,
    ...(row.command ? { command: row.command } : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(row.args ? { args: [...row.args] } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(row.cwdAllowWorkspace === true ? { cwdAllowWorkspace: true } : {}),
  }));
}

function parseServersInput(raw: unknown): McpServerRow[] | string {
  if (raw === undefined) return [];
  const forbidden = mcpServersForbiddenEnvMessage(raw);
  if (forbidden) return forbidden;
  try {
    return parseMcpServersValue(raw, { keepEnv: true }).map((row) => {
      return {
        serverName: row.serverName,
        ...(row.url ? { url: row.url } : {}),
        ...(row.command ? { command: row.command } : {}),
        ...(row.args ? { args: [...row.args] } : {}),
        ...(row.cwd ? { cwd: row.cwd } : {}),
        ...(row.cwdAllowWorkspace === true ? { cwdAllowWorkspace: true } : {}),
        ...(row.env ? { env: { ...row.env } } : {}),
      };
    });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function normalizeDeny(raw: unknown): string[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return "denyGlobal must be a string array";
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") return "denyGlobal entries must be strings";
    const name = entry.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

async function invalidateXiangyangAgents(runtime: FaceRuntime): Promise<void> {
  const invalidate = runtime.invalidateAgent
    ? (sessionId: string) => runtime.invalidateAgent?.(sessionId)
    : undefined;
  if (!invalidate) return;
  for (const [sessionId, wsId] of runtime.workspaces.listMembership()) {
    if (wsId !== XIANGYANG_WORKSPACE_ID) continue;
    await Promise.resolve(invalidate(sessionId)).catch(() => undefined);
  }
}

/** Face `mcp.workspace.get` */
export async function mcpWorkspaceGet(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<
  FaceRpcResult<{
    readonly workspaceId: string;
    readonly path: string;
    readonly servers: readonly McpWorkspaceServerDraft[];
    readonly denyGlobal: readonly string[];
    readonly fingerprint: string;
  }>
> {
  const p = asRecord(payload) ?? {};
  const workspaceId =
    typeof p.workspaceId === "string" ? p.workspaceId : "";
  const resolved = resolveProjectWorkspaceRoot(runtime, workspaceId);
  if (!resolved.ok) return resolved;
  const file = readWorkspaceMcpFile(resolved.value.path);
  return {
    ok: true,
    value: {
      workspaceId: resolved.value.workspaceId,
      path: resolved.value.path,
      servers: draftsFromRows(file.servers),
      denyGlobal: [...file.denyGlobal],
      fingerprint: file.fingerprint,
    },
  };
}

/** Face `mcp.workspace.set` */
export async function mcpWorkspaceSet(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<
  FaceRpcResult<{
    readonly workspaceId: string;
    readonly path: string;
    readonly servers: readonly McpWorkspaceServerDraft[];
    readonly denyGlobal: readonly string[];
    readonly fingerprint: string;
  }>
> {
  const p = asRecord(payload) ?? {};
  const workspaceId =
    typeof p.workspaceId === "string" ? p.workspaceId : "";
  const resolved = resolveProjectWorkspaceRoot(runtime, workspaceId);
  if (!resolved.ok) return resolved;
  const servers = parseServersInput(p.servers);
  if (typeof servers === "string") {
    return {
      ok: false,
      error: { code: "mcp-workspace-invalid", message: servers },
    };
  }
  const denyGlobal = normalizeDeny(p.denyGlobal);
  if (typeof denyGlobal === "string") {
    return {
      ok: false,
      error: { code: "mcp-workspace-invalid", message: denyGlobal },
    };
  }
  let written;
  try {
    written = writeWorkspaceMcpFile(resolved.value.path, {
      servers,
      denyGlobal,
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "mcp-workspace-persist-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  await invalidateXiangyangAgents(runtime);
  return {
    ok: true,
    value: {
      workspaceId: resolved.value.workspaceId,
      path: resolved.value.path,
      servers: draftsFromRows(written.servers),
      denyGlobal: [...written.denyGlobal],
      fingerprint: written.fingerprint,
    },
  };
}
