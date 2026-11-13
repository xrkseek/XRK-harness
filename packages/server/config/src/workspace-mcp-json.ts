/**
 * Per-workspace MCP overlay file `{workspace}/.xrk/mcp.json`.
 * Shared by Host (Xiangyang mount) and Face (Settings / settings_* tools).
 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseJsonText } from "./json-text.js";
import {
  parseMcpServersValue,
  pickMcpAllowedEnv,
  type McpServerRow,
} from "./mcp-servers.js";

/** Workspace overlay from `{workspace}/.xrk/mcp.json`. */
export type WorkspaceMcpFile = {
  readonly servers: readonly McpServerRow[];
  /** Global host-settings server names to hide when this overlay is focused. */
  readonly denyGlobal: readonly string[];
  /** Stable fingerprint (empty when file absent / unreadable). */
  readonly fingerprint: string;
};

const EMPTY: WorkspaceMcpFile = Object.freeze({
  servers: Object.freeze([]),
  denyGlobal: Object.freeze([]),
  fingerprint: "",
});

/** Empty overlay (missing / unreadable file). */
export function emptyWorkspaceMcpFile(): WorkspaceMcpFile {
  return EMPTY;
}

function normalizeDenyGlobal(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function fingerprintOf(
  servers: readonly McpServerRow[],
  denyGlobal: readonly string[],
): string {
  return JSON.stringify({
    servers: servers
      .map((s) =>
        JSON.stringify({
          n: s.serverName,
          c: s.command ?? "",
          u: s.url ?? "",
          a: s.args ?? [],
          d: s.cwd ?? "",
          w: s.cwdAllowWorkspace === true,
          e: s.env ?? {},
        }),
      )
      .sort(),
    deny: [...denyGlobal].sort(),
  });
}

/**
 * Read `{workspaceRoot}/.xrk/mcp.json`.
 * Shape: `{ servers | mcpServers, denyGlobal?: string[] }`.
 * Missing / invalid → empty overlay.
 */
export function readWorkspaceMcpFile(workspaceRoot: string): WorkspaceMcpFile {
  const root = workspaceRoot.trim();
  if (!root) return EMPTY;
  const file = path.join(path.resolve(root), ".xrk", "mcp.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return EMPTY;
    }
    console.warn(
      `[config] ${file}: read failed; ignoring workspace MCP overlay (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return EMPTY;
  }
  let parsed: unknown;
  try {
    parsed = parseJsonText(raw);
  } catch (err) {
    console.warn(
      `[config] ${file}: parse failed; ignoring workspace MCP overlay (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(`[config] ${file}: root must be an object; ignoring`);
    return EMPTY;
  }
  const obj = parsed as {
    servers?: unknown;
    mcpServers?: unknown;
    denyGlobal?: unknown;
  };
  const serversRaw =
    obj.servers !== undefined
      ? obj.servers
      : obj.mcpServers !== undefined
        ? { mcpServers: obj.mcpServers }
        : undefined;
  let servers: readonly McpServerRow[] = [];
  if (serversRaw !== undefined) {
    try {
      servers = parseMcpServersValue(serversRaw, { keepEnv: true }).map(
        (row) => {
          const env = pickMcpAllowedEnv(row.env);
          return {
            serverName: row.serverName,
            ...(row.url ? { url: row.url } : {}),
            ...(row.command ? { command: row.command } : {}),
            ...(row.args ? { args: [...row.args] } : {}),
            ...(row.cwd ? { cwd: row.cwd } : {}),
            ...(row.cwdAllowWorkspace === true
              ? { cwdAllowWorkspace: true }
              : {}),
            ...(env ? { env } : {}),
          };
        },
      );
    } catch (err) {
      console.warn(
        `[config] ${file}: servers invalid; ignoring (${
          err instanceof Error ? err.message : String(err)
        })`,
      );
      servers = [];
    }
  }
  const denyGlobal = normalizeDenyGlobal(obj.denyGlobal);
  return {
    servers,
    denyGlobal,
    fingerprint: fingerprintOf(servers, denyGlobal),
  };
}

/**
 * Atomically write `{workspaceRoot}/.xrk/mcp.json` as `{ servers, denyGlobal? }`.
 */
export function writeWorkspaceMcpFile(
  workspaceRoot: string,
  input: {
    readonly servers: readonly McpServerRow[];
    readonly denyGlobal?: readonly string[];
  },
): WorkspaceMcpFile {
  const root = workspaceRoot.trim();
  if (!root) {
    throw new Error("workspaceRoot required for workspace MCP write");
  }
  const abs = path.resolve(root);
  const dir = path.join(abs, ".xrk");
  const file = path.join(dir, "mcp.json");
  const denyGlobal = normalizeDenyGlobal(input.denyGlobal ?? []);
  const servers = input.servers.map((row) => {
    const name = row.serverName.trim();
    if (!name) throw new Error("serverName required");
    const out: Record<string, unknown> = { serverName: name };
    if (row.url?.trim()) out.url = row.url.trim();
    if (row.command?.trim()) out.command = row.command.trim();
    if (row.args && row.args.length > 0) out.args = [...row.args];
    if (row.cwd?.trim()) out.cwd = row.cwd.trim();
    if (row.cwdAllowWorkspace === true) out.cwdAllowWorkspace = true;
    if (row.env && Object.keys(row.env).length > 0) {
      const env = pickMcpAllowedEnv(row.env);
      if (env) out.env = env;
    }
    return out;
  });
  const body = {
    servers,
    ...(denyGlobal.length > 0 ? { denyGlobal: [...denyGlobal] } : {}),
  };
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
  return readWorkspaceMcpFile(abs);
}
