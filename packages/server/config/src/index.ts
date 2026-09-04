import { existsSync } from "node:fs";
import type { SessionStore } from "@xrkseek/core-session";
import type { SessionEvent } from "@xrkseek/protocol";
import { defaultPluginsDir } from "./home.js";
import { parseMcpServersJson, type McpServerRow } from "./mcp-servers.js";

export type { SessionStore, SessionEvent };
export type { McpServerRow };
export {
  XRK_HOME_DIR_NAME,
  XRK_HOME_ENVS,
  defaultPluginsDir,
  defaultSessionsDir,
  defaultXrkHome,
  hostSettingsPath,
  resolveXrkHome,
} from "./home.js";
export {
  mcpServersContainEnv,
  mcpServersObjectMap,
  parseMcpServersJson,
  parseMcpServersValue,
} from "./mcp-servers.js";

export interface HostCredentials {
  /** API key for /api/* ; empty disables auth (dev only). */
  readonly apiKey: string;
}

/** Host `--preset` / `XRK_PRESET` ids (mirrors Face `HOST_CLI_PRESET_IDS`). */
export const HOST_RUNTIME_PRESET_IDS = [
  "minimal",
  "shell",
  "frugal",
  "plan",
  "shallow",
  "harness",
  "server",
] as const;

export type HostRuntimePresetId = (typeof HOST_RUNTIME_PRESET_IDS)[number];

export function isHostRuntimePresetId(v: string): v is HostRuntimePresetId {
  return (HOST_RUNTIME_PRESET_IDS as readonly string[]).includes(v);
}

export interface HostRuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly workspaceRoot: string;
  readonly preset: HostRuntimePresetId;
  readonly corsOrigin: string | "*";
  readonly rateLimitPerMinute: number;
  /**
   * Optional plugin root for `loader.loadAll` on host spawn.
   * Env: `XRK_PLUGINS_DIR`. When unset, `{XRK_HOME}/plugins` if that
   * directory already exists (created by `xrk-harness plugin add`).
   * Empty / omit = skip discover.
   */
  readonly pluginsDir?: string;
  /**
   * Optional SPA dist directory served by HTTP (public GET).
   * Env: `XRK_WEB_DIST`. CLI resolves: override → package `product-web/` → monorepo `apps/web/dist`.
   */
  readonly webDist?: string;
  /**
   * Optional policy ruleset JSON path (Face `provider.use` + preset may share).
   * Env: `XRK_POLICY_FILE`.
   */
  readonly policyFile?: string;
  /**
   * MCP stdio/http servers JSON (Host registers as `kind: tools` plugins).
   * Env: `XRK_MCP_SERVERS` — array `[{serverName,command|url,...}]` or Cursor/Claude
   * object `{ "mcpServers": { "name": { "command": "npx", "args": [...] } } }`.
   * Connect still needs allow (`XRK_MCP_ALLOW=1` or policy allow for mcp.connect).
   */
  readonly mcpServers?: readonly McpServerRow[];
  /** Env: `XRK_MCP_ALLOW=1` elevates mcp.connect default to allow for configured servers. */
  readonly mcpAllowConnect?: boolean;
  /**
   * Session persistence directory (`sessions.db`). Env: `XRK_SESSIONS_DIR`.
   * Omit → in-memory store (process lifetime only).
   */
  readonly sessionsDir?: string;
}

export interface HostConfig {
  readonly credentials: HostCredentials;
  readonly runtime: HostRuntimeConfig;
  readonly patch: Record<string, unknown>;
}

export interface LoadConfigInput {
  readonly env?: NodeJS.ProcessEnv;
  readonly patch?: Record<string, unknown>;
  readonly defaults?: Partial<HostRuntimeConfig>;
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Layered config: defaults < env < patch. Secrets only from env. */
export function loadHostConfig(input: LoadConfigInput = {}): HostConfig {
  const env = input.env ?? process.env;
  const defaults: HostRuntimeConfig = {
    host: "127.0.0.1",
    port: 8787,
    workspaceRoot: process.cwd(),
    preset: "harness",
    corsOrigin: "*",
    rateLimitPerMinute: 120,
    ...input.defaults,
  };

  const runtime = {
    host: String(env.XRK_HOST ?? defaults.host),
    port: num(env.XRK_PORT, defaults.port),
    workspaceRoot: String(env.XRK_WORKSPACE ?? defaults.workspaceRoot),
    preset: (isHostRuntimePresetId(String(env.XRK_PRESET ?? ""))
      ? (env.XRK_PRESET as HostRuntimePresetId)
      : defaults.preset),
    corsOrigin: String(env.XRK_CORS_ORIGIN ?? defaults.corsOrigin),
    rateLimitPerMinute: num(
      env.XRK_RATE_LIMIT,
      defaults.rateLimitPerMinute,
    ),
    ...(defaults.pluginsDir
      ? { pluginsDir: defaults.pluginsDir }
      : {}),
    ...(!defaults.pluginsDir &&
    !(env.XRK_PLUGINS_DIR && String(env.XRK_PLUGINS_DIR).trim())
      ? (() => {
          const homePlugins = defaultPluginsDir(env);
          return existsSync(homePlugins) ? { pluginsDir: homePlugins } : {};
        })()
      : {}),
    ...(env.XRK_PLUGINS_DIR && String(env.XRK_PLUGINS_DIR).trim()
      ? { pluginsDir: String(env.XRK_PLUGINS_DIR).trim() }
      : {}),
    ...(env.XRK_WEB_DIST && String(env.XRK_WEB_DIST).trim()
      ? { webDist: String(env.XRK_WEB_DIST).trim() }
      : {}),
    ...(env.XRK_POLICY_FILE && String(env.XRK_POLICY_FILE).trim()
      ? { policyFile: String(env.XRK_POLICY_FILE).trim() }
      : {}),
    ...(defaults.policyFile && !env.XRK_POLICY_FILE
      ? { policyFile: defaults.policyFile }
      : {}),
    ...(env.XRK_MCP_SERVERS && String(env.XRK_MCP_SERVERS).trim()
      ? {
          mcpServers: parseMcpServersJson(String(env.XRK_MCP_SERVERS).trim()),
        }
      : {}),
    ...(env.XRK_MCP_ALLOW === "1" || env.XRK_MCP_ALLOW === "true"
      ? { mcpAllowConnect: true as const }
      : {}),
    ...(env.XRK_SESSIONS_DIR && String(env.XRK_SESSIONS_DIR).trim()
      ? { sessionsDir: String(env.XRK_SESSIONS_DIR).trim() }
      : {}),
  } as HostRuntimeConfig;

  const patch = { ...(input.patch ?? {}) };
  const mutable = runtime as {
    port: number;
    host: string;
    workspaceRoot: string;
    preset: HostRuntimeConfig["preset"];
    pluginsDir?: string;
    webDist?: string;
    policyFile?: string;
    sessionsDir?: string;
  };
  if (typeof patch.port === "number") mutable.port = patch.port;
  if (typeof patch.host === "string") mutable.host = patch.host;
  if (typeof patch.workspaceRoot === "string") {
    mutable.workspaceRoot = patch.workspaceRoot;
  }
  if (typeof patch.preset === "string" && isHostRuntimePresetId(patch.preset)) {
    mutable.preset = patch.preset;
  }
  if (typeof patch.pluginsDir === "string") {
    const dir = patch.pluginsDir.trim();
    if (dir) mutable.pluginsDir = dir;
    else delete mutable.pluginsDir;
  }
  if (typeof patch.webDist === "string") {
    const dir = patch.webDist.trim();
    if (dir) mutable.webDist = dir;
    else delete mutable.webDist;
  }
  if (typeof patch.policyFile === "string") {
    const f = patch.policyFile.trim();
    if (f) mutable.policyFile = f;
    else delete mutable.policyFile;
  }
  if (typeof patch.sessionsDir === "string") {
    const d = patch.sessionsDir.trim();
    if (d) mutable.sessionsDir = d;
    else delete mutable.sessionsDir;
  }

  return {
    credentials: {
      apiKey: String(env.XRK_API_KEY ?? ""),
    },
    runtime,
    patch,
  };
}

export interface ChatSessionService {
  readonly store: SessionStore;
  ensureSession(id?: string): string;
  getEvents(sessionId: string): readonly SessionEvent[];
}
