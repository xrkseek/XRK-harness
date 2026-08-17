import type { SessionStore } from "@xrkseek/core-session";
import type { SessionEvent } from "@xrkseek/protocol";

export type { SessionStore, SessionEvent };

export interface HostCredentials {
  /** API key for /api/* ; empty disables auth (dev only). */
  readonly apiKey: string;
}

export interface HostRuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly workspaceRoot: string;
  readonly preset: "minimal" | "harness" | "server";
  readonly corsOrigin: string | "*";
  readonly rateLimitPerMinute: number;
  /**
   * Optional plugin root for `loader.loadAll` on host spawn.
   * Env: `XRK_PLUGINS_DIR`. Empty / omit = skip discover.
   */
  readonly pluginsDir?: string;
  /**
   * Optional SPA dist directory served by HTTP (public GET).
   * Env: `XRK_WEB_DIST`. Typically `apps/web/dist` after `vite build`.
   */
  readonly webDist?: string;
  /**
   * Optional policy ruleset JSON path (Face `provider.use` + preset may share).
   * Env: `XRK_POLICY_FILE`.
   */
  readonly policyFile?: string;
  /**
   * MCP stdio servers JSON (Host registers as `kind: tools` plugins).
   * Env: `XRK_MCP_SERVERS` — `[{serverName,command,args?,env?,cwd?}]`.
   * Connect still needs allow (`XRK_MCP_ALLOW=1` or policy allow for mcp.connect).
   */
  readonly mcpServers?: readonly {
    readonly serverName: string;
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
  }[];
  /** Env: `XRK_MCP_ALLOW=1` elevates mcp.connect default to allow for configured servers. */
  readonly mcpAllowConnect?: boolean;
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

function parseMcpServersJson(raw: string): HostRuntimeConfig["mcpServers"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("XRK_MCP_SERVERS must be valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("XRK_MCP_SERVERS must be a JSON array");
  }
  type McpServerSpec = {
    serverName: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
  const out: McpServerSpec[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const serverName = String(o.serverName ?? "").trim();
    const command = String(o.command ?? "").trim();
    if (!serverName || !command) {
      throw new Error("XRK_MCP_SERVERS entry requires serverName and command");
    }
    out.push({
      serverName,
      command,
      ...(Array.isArray(o.args) ? { args: o.args.map((a) => String(a)) } : {}),
      ...(o.env && typeof o.env === "object" && !Array.isArray(o.env)
        ? {
            env: Object.fromEntries(
              Object.entries(o.env as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v),
              ]),
            ),
          }
        : {}),
      ...(typeof o.cwd === "string" && o.cwd.trim()
        ? { cwd: o.cwd.trim() }
        : {}),
    });
  }
  return out;
}

/** Layered config: defaults < env < patch. Secrets only from env. */
export function loadHostConfig(input: LoadConfigInput = {}): HostConfig {
  const env = input.env ?? process.env;
  const defaults: HostRuntimeConfig = {
    host: "127.0.0.1",
    port: 8787,
    workspaceRoot: process.cwd(),
    preset: "minimal",
    corsOrigin: "*",
    rateLimitPerMinute: 120,
    ...input.defaults,
  };

  const runtime = {
    host: String(env.XRK_HOST ?? defaults.host),
    port: num(env.XRK_PORT, defaults.port),
    workspaceRoot: String(env.XRK_WORKSPACE ?? defaults.workspaceRoot),
    preset: (["minimal", "harness", "server"].includes(String(env.XRK_PRESET))
      ? (env.XRK_PRESET as HostRuntimeConfig["preset"])
      : defaults.preset),
    corsOrigin: String(env.XRK_CORS_ORIGIN ?? defaults.corsOrigin),
    rateLimitPerMinute: num(
      env.XRK_RATE_LIMIT,
      defaults.rateLimitPerMinute,
    ),
    ...(defaults.pluginsDir
      ? { pluginsDir: defaults.pluginsDir }
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
  };
  if (typeof patch.port === "number") mutable.port = patch.port;
  if (typeof patch.host === "string") mutable.host = patch.host;
  if (typeof patch.workspaceRoot === "string") {
    mutable.workspaceRoot = patch.workspaceRoot;
  }
  if (
    typeof patch.preset === "string" &&
    ["minimal", "harness", "server"].includes(patch.preset)
  ) {
    mutable.preset = patch.preset as HostRuntimeConfig["preset"];
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
