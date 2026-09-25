/**
 * Host MCP wiring: Face `mcp.servers` + `mcp.allowConnect` in
 * `~/.xrk/host-settings.json` (Web Settings). Optional env
 * `XRK_MCP_SERVERS` / `XRK_MCP_ALLOW` override for headless/CI.
 * Registers each connected server as a synthetic `kind: tools` plugin;
 * live reconcile after `settings.mutate` (no spawn restart) when file-sourced.
 */

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  parseJsonText,
  parseMcpServersJson,
  parseMcpServersValue,
  pickMcpAllowedEnv,
  resolveMcpStdioCwd,
} from "@xrkseek/server-config";
import {
  createMcpClient,
  createMcpResourceTools,
  mcpToolDefinition,
  MCP_RESOURCES_PLUGIN_ID,
  type McpClient,
  type McpConnectionStatus,
} from "@xrkseek/mcp";
import {
  assertPolicyAllow,
  createPolicyEngine,
  type PolicyEngine,
} from "@xrkseek/policy";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

export type McpServerSpec =
  | {
      readonly serverName: string;
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
      readonly cwd?: string;
      readonly cwdAllowWorkspace?: boolean;
    }
  | {
      readonly serverName: string;
      readonly url: string;
      readonly requestInit?: RequestInit;
    };

/** Face draft shape → Host stdio/http specs (proxy env allowed). */
export type McpServerDraft = {
  readonly serverName: string;
  readonly command?: string;
  readonly url?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly cwdAllowWorkspace?: boolean;
  readonly env?: Readonly<Record<string, string>>;
};

/** Plugin carrying supervisor health + desired-spec fingerprint for reconcile. */
export type McpRegisteredPlugin = RegisteredPlugin & {
  mcpHealth: McpConnectionStatus;
  mcpFingerprint: string;
  /** Live client for shared resource tools (`mcp-resources`). */
  mcpClient: McpClient;
};

function rowToSpec(row: {
  readonly serverName: string;
  readonly command?: string;
  readonly url?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly cwdAllowWorkspace?: boolean;
}): McpServerSpec | undefined {
  const serverName = row.serverName.trim();
  if (!serverName) return undefined;
  const url = typeof row.url === "string" ? row.url.trim() : "";
  if (url) return { serverName, url };
  const command = typeof row.command === "string" ? row.command.trim() : "";
  if (!command) return undefined;
  return {
    serverName,
    command,
    ...(row.args && row.args.length > 0 ? { args: [...row.args] } : {}),
    ...(row.env ? { env: { ...row.env } } : {}),
    ...(row.cwd?.trim() ? { cwd: row.cwd.trim() } : {}),
    ...(row.cwdAllowWorkspace === true ? { cwdAllowWorkspace: true } : {}),
  };
}

export function parseMcpServersEnv(
  raw: string | undefined,
): readonly McpServerSpec[] {
  if (!raw || !raw.trim()) return [];
  return parseMcpServersJson(raw)
    .map(rowToSpec)
    .filter((s): s is McpServerSpec => s !== undefined);
}

/**
 * Face dump `{ mcp.servers }` / root `mcpServers` → Host specs.
 * Proxy env keys are kept; other env keys are dropped.
 * Parse failure keeps the last successfully read specs for that file
 * (DSH last-good; keyed by absolute path).
 */
const lastGoodMcpSpecsByFile = new Map<string, readonly McpServerSpec[]>();
/** Last successfully read `mcp.allowConnect` per host-settings path. */
const lastGoodMcpAllowByFile = new Map<string, boolean>();

/** Test helper — clear Host MCP last-good caches. */
export function resetLastGoodHostMcpWireCaches(): void {
  lastGoodMcpSpecsByFile.clear();
  lastGoodMcpAllowByFile.clear();
}

export function readMcpServersFromHostSettings(
  file: string,
): readonly McpServerSpec[] {
  const key = path.resolve(file);
  const lastGood = lastGoodMcpSpecsByFile.get(key);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return lastGood ?? [];
    }
    console.warn(
      `[host] ${file}: read failed; keeping last good MCP specs (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return lastGood ?? [];
  }
  let parsed: unknown;
  try {
    parsed = parseJsonText(raw);
  } catch (err) {
    console.warn(
      `[host] ${file}: parse failed; keeping last good MCP specs (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return lastGood ?? [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(
      `[host] ${file}: root must be an object; keeping last good MCP specs`,
    );
    return lastGood ?? [];
  }
  const root = parsed as {
    mcp?: { servers?: unknown };
  };
  const servers = root.mcp?.servers;
  if (servers === undefined) {
    // Truncated / partial write — do not wipe last-good with an empty list.
    if (lastGood !== undefined) {
      console.warn(
        `[host] ${file}: mcp.servers missing; keeping last good MCP specs`,
      );
      return lastGood;
    }
    return [];
  }
  try {
    const specs = mcpDraftsToSpecs(
      parseMcpServersValue(servers, { keepEnv: true }).map((row) => {
        const env = pickMcpAllowedEnv(row.env);
        return {
          serverName: row.serverName,
          ...(row.url ? { url: row.url } : {}),
          ...(row.command ? { command: row.command } : {}),
          ...(row.args ? { args: [...row.args] } : {}),
          ...(row.cwd ? { cwd: row.cwd } : {}),
          ...(env ? { env } : {}),
        };
      }),
    );
    lastGoodMcpSpecsByFile.set(key, specs);
    return specs;
  } catch (err) {
    console.warn(
      `[host] ${file}: mcp.servers invalid; keeping last good MCP specs (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return lastGood ?? [];
  }
}

/**
 * Face dump `mcp.allowConnect` (Web Settings).
 * Parse/read failure keeps last good for that file (aligned with servers).
 */
export function readMcpAllowFromHostSettings(file: string): boolean {
  const key = path.resolve(file);
  const lastGood = lastGoodMcpAllowByFile.get(key);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return lastGood ?? false;
    }
    console.warn(
      `[host] ${file}: read failed; keeping last good mcp.allowConnect (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return lastGood ?? false;
  }
  let parsed: unknown;
  try {
    parsed = parseJsonText(raw);
  } catch (err) {
    console.warn(
      `[host] ${file}: parse failed; keeping last good mcp.allowConnect (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return lastGood ?? false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(
      `[host] ${file}: root must be an object; keeping last good mcp.allowConnect`,
    );
    return lastGood ?? false;
  }
  const mcp = (parsed as { mcp?: { allowConnect?: unknown } }).mcp;
  if (mcp === undefined || typeof mcp !== "object" || Array.isArray(mcp)) {
    if (lastGood !== undefined) {
      console.warn(
        `[host] ${file}: mcp section missing; keeping last good mcp.allowConnect`,
      );
      return lastGood;
    }
    return false;
  }
  const allow = mcp.allowConnect === true;
  lastGoodMcpAllowByFile.set(key, allow);
  return allow;
}

/** Convert Face desired drafts into Host connect specs (skips incomplete rows). */
export function mcpDraftsToSpecs(
  drafts: readonly McpServerDraft[],
): McpServerSpec[] {
  return drafts
    .map(rowToSpec)
    .filter((s): s is McpServerSpec => s !== undefined);
}

/** Stable id for reconcile keep/replace. Includes env so env-only edits remount. */
export function mcpFingerprint(spec: McpServerSpec): string {
  if ("url" in spec) {
    return JSON.stringify({ n: spec.serverName, u: spec.url });
  }
  const env = spec.env
    ? Object.keys(spec.env)
        .sort()
        .map((k) => [k, spec.env![k] ?? ""])
    : [];
  return JSON.stringify({
    n: spec.serverName,
    c: spec.command,
    a: [...(spec.args ?? [])],
    d: spec.cwd ?? "",
    w: spec.cwdAllowWorkspace === true,
    e: env,
  });
}

function connectPolicy(
  base: PolicyEngine | undefined,
  allowEnv: boolean,
): PolicyEngine {
  if (allowEnv) {
    return createPolicyEngine({
      defaults: { "mcp.connect": "allow" },
    });
  }
  return base ?? createPolicyEngine();
}

async function toolsFromClient(client: McpClient) {
  const listed = await client.listTools();
  return listed.map((info) => mcpToolDefinition(client, info));
}

function isMcpPlugin(plugin: RegisteredPlugin): plugin is McpRegisteredPlugin {
  return (
    plugin.id.startsWith("mcp:") &&
    typeof (plugin as McpRegisteredPlugin).mcpFingerprint === "string" &&
    (plugin as McpRegisteredPlugin).mcpClient !== undefined
  );
}

/** Resolve live MCP client for shared resource tools. */
function resolveMcpClientFromList(
  list: () => readonly RegisteredPlugin[],
  serverName: string,
): McpClient | undefined {
  const plugin = list().find(
    (p): p is McpRegisteredPlugin =>
      isMcpPlugin(p) && p.id === `mcp:${serverName}`,
  );
  if (!plugin || plugin.mcpHealth === "gave-up") return undefined;
  return plugin.mcpClient;
}

/**
 * Keep one shared `mcp-resources` plugin while any MCP server is connected.
 * Tools disappear when the last server unloads (DSH mcp-resources).
 * `retained` covers mid-drain soft-detached clients still serving in-flight tools.
 */
async function syncMcpResourcePlugin(options: {
  readonly list: () => readonly RegisteredPlugin[];
  readonly retained?: () => readonly RegisteredPlugin[];
  readonly register: (plugin: RegisteredPlugin) => void;
  readonly unregister: (id: string) => Promise<void>;
}): Promise<void> {
  const live = options.list().filter(
    (p): p is McpRegisteredPlugin =>
      isMcpPlugin(p) && p.mcpHealth !== "gave-up",
  );
  const existing = options.list().find((p) => p.id === MCP_RESOURCES_PLUGIN_ID);
  if (live.length === 0) {
    if (existing) await options.unregister(MCP_RESOURCES_PLUGIN_ID);
    return;
  }
  if (existing) return;
  const clients = () => {
    const retained = options.retained?.() ?? [];
    return retained.length > 0
      ? [...options.list(), ...retained]
      : options.list();
  };
  options.register({
    id: MCP_RESOURCES_PLUGIN_ID,
    kind: "tools",
    tools: createMcpResourceTools({
      resolveClient: (serverName) =>
        resolveMcpClientFromList(clients, serverName),
    }),
  });
}

async function connectOneMcpPlugin(
  spec: McpServerSpec,
  policy: PolicyEngine,
  hooks?: {
    readonly onToolsChanged?: (serverName: string) => void | Promise<void>;
    readonly onHealthChanged?: (
      serverName: string,
      status: McpConnectionStatus,
    ) => void | Promise<void>;
  },
  imageAdmission?: import("@xrkseek/mcp").McpImageAdmission,
  workspaceRoot?: string,
): Promise<McpRegisteredPlugin> {
  assertPolicyAllow(policy, {
    kind: "mcp.connect",
    serverId: spec.serverName,
  });
  const client =
    "url" in spec
      ? createMcpClient({
          transport: "http",
          serverName: spec.serverName,
          url: spec.url,
          ...(spec.requestInit ? { requestInit: spec.requestInit } : {}),
          reconnectionOptions: { maxRetries: 2 },
          policy,
          ...(imageAdmission ? { imageAdmission } : {}),
        })
      : createMcpClient({
          serverName: spec.serverName,
          command: spec.command,
          ...(spec.args ? { args: spec.args } : {}),
          ...(spec.env ? { env: spec.env } : {}),
          // Omit cwd → ~/.xrk/mcp-cwd/<name>. Workspace cwd needs cwdAllowWorkspace.
          cwd: (() => {
            const cwd = resolveMcpStdioCwd({
              serverName: spec.serverName,
              workspaceRoot: workspaceRoot ?? process.cwd(),
              ...(spec.cwd ? { cwd: spec.cwd } : {}),
              ...(spec.cwdAllowWorkspace === true
                ? { cwdAllowWorkspace: true }
                : {}),
            });
            mkdirSync(cwd, { recursive: true });
            return cwd;
          })(),
          policy,
          ...(imageAdmission ? { imageAdmission } : {}),
        });
  try {
    await client.connect();
    const tools = await toolsFromClient(client);
    let refresh = Promise.resolve();
    const unsub = client.onToolsListChanged(() => {
      refresh = refresh.then(async () => {
        try {
          const next = await toolsFromClient(client);
          tools.splice(0, tools.length, ...next);
          await hooks?.onToolsChanged?.(spec.serverName);
        } catch {
          /* keep previous generation */
        }
      });
      return refresh;
    });
    const plugin: McpRegisteredPlugin = {
      id: `mcp:${spec.serverName}`,
      kind: "tools",
      tools,
      mcpHealth: "connected",
      mcpFingerprint: mcpFingerprint(spec),
      mcpClient: client,
      async dispose() {
        unsubState();
        unsub();
        await client.dispose();
      },
    };
    const unsubState = client.onConnectionState((state) => {
      plugin.mcpHealth = state.status;
      void hooks?.onHealthChanged?.(spec.serverName, state.status);
      if (state.status === "gave-up") {
        tools.splice(0, tools.length);
        void hooks?.onToolsChanged?.(spec.serverName);
      } else if (state.status === "connected") {
        // Re-list after a successful reconnect generation.
        refresh = refresh.then(async () => {
          try {
            const next = await toolsFromClient(client);
            tools.splice(0, tools.length, ...next);
            await hooks?.onToolsChanged?.(spec.serverName);
          } catch {
            /* keep previous generation */
          }
        });
      }
    });
    return plugin;
  } catch (err) {
    await client.dispose();
    throw err;
  }
}

/**
 * Connect configured MCP servers; return plugins for loader.register.
 * Callers must dispose via plugin.dispose / loader.unregister.
 * Subscribes to `tools/list_changed`: mutates `plugin.tools` in place and
 * invokes `onToolsChanged` so Host can invalidate agent caches.
 */
export async function loadMcpToolPlugins(options: {
  readonly specs: readonly McpServerSpec[];
  readonly policy?: PolicyEngine;
  /** When true (XRK_MCP_ALLOW=1), elevate mcp.connect default to allow. */
  readonly allowConnect?: boolean;
  /** Host workspace root — used to gate stdio cwd under the workspace. */
  readonly workspaceRoot?: string;
  /** Fired after a successful list_changed re-list (not on fetch failure). */
  readonly onToolsChanged?: (serverName: string) => void | Promise<void>;
  /** Fired on supervisor health transitions (connected / reconnecting / gave-up). */
  readonly onHealthChanged?: (
    serverName: string,
    status: McpConnectionStatus,
  ) => void | Promise<void>;
  /**
   * When set, MCP image blocks may be admitted to the AttachmentStore and
   * returned as ContentBlock[] for multimodal model routes (DSH mcp-client).
   */
  readonly imageAdmission?: import("@xrkseek/mcp").McpImageAdmission;
}): Promise<readonly McpRegisteredPlugin[]> {
  if (options.specs.length === 0) return [];
  const policy = connectPolicy(options.policy, Boolean(options.allowConnect));
  const plugins: McpRegisteredPlugin[] = [];
  const hooks = {
    ...(options.onToolsChanged ? { onToolsChanged: options.onToolsChanged } : {}),
    ...(options.onHealthChanged
      ? { onHealthChanged: options.onHealthChanged }
      : {}),
  };

  try {
    for (const spec of options.specs) {
      plugins.push(
        await connectOneMcpPlugin(
          spec,
          policy,
          hooks,
          options.imageAdmission,
          options.workspaceRoot,
        ),
      );
    }
  } catch (err) {
    for (const plugin of plugins) {
      try {
        await plugin.dispose?.();
      } catch {
        /* continue unwinding */
      }
    }
    throw err;
  }

  return plugins;
}

export interface ReconcileMcpResult {
  readonly failures: readonly { readonly serverName: string; readonly message: string }[];
  /** Desired servers not connected because policy denied (expected when allow=off). */
  readonly parked: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

/**
 * Diff desired MCP specs against live `mcp:*` plugins: unregister removed /
 * changed / gave-up, connect additions. Per-server connect failures are
 * collected (other servers still apply). Duplicate `serverName` in desired:
 * last entry wins.
 */
export async function reconcileMcpToolPlugins(options: {
  readonly desired: readonly McpServerSpec[];
  readonly list: () => readonly RegisteredPlugin[];
  readonly register: (plugin: RegisteredPlugin) => void;
  readonly unregister: (id: string) => Promise<void>;
  readonly policy?: PolicyEngine;
  readonly allowConnect?: boolean;
  /** Host workspace root — used to gate stdio cwd under the workspace. */
  readonly workspaceRoot?: string;
  /**
   * Soft-detached MCP plugins still alive for mid-drain tool calls.
   * Used only by `mcp-resources` client resolution — not by reconcile keep/drop.
   */
  readonly retained?: () => readonly RegisteredPlugin[];
  readonly onToolsChanged?: (serverName: string) => void | Promise<void>;
  readonly onHealthChanged?: (
    serverName: string,
    status: McpConnectionStatus,
  ) => void | Promise<void>;
  readonly imageAdmission?: import("@xrkseek/mcp").McpImageAdmission;
}): Promise<ReconcileMcpResult> {
  const allow = Boolean(options.allowConnect);
  const policy = connectPolicy(options.policy, allow);
  const desiredById = new Map<string, McpServerSpec>(
    options.desired.map((spec) => [`mcp:${spec.serverName}`, spec]),
  );
  const current = options.list().filter(isMcpPlugin);
  const removed: string[] = [];
  const kept: string[] = [];
  const toAdd: McpServerSpec[] = [];
  const hooks = {
    ...(options.onToolsChanged ? { onToolsChanged: options.onToolsChanged } : {}),
    ...(options.onHealthChanged
      ? { onHealthChanged: options.onHealthChanged }
      : {}),
  };

  // Allow off: disconnect everything and park desired (Web Settings toggle).
  if (!allow) {
    for (const plugin of current) {
      await options.unregister(plugin.id);
      removed.push(plugin.id);
    }
    if (options.list().some((p) => p.id === MCP_RESOURCES_PLUGIN_ID)) {
      await options.unregister(MCP_RESOURCES_PLUGIN_ID);
      removed.push(MCP_RESOURCES_PLUGIN_ID);
    }
    return {
      failures: [],
      parked: options.desired.map((s) => s.serverName),
      added: [],
      removed,
      kept: [],
    };
  }

  for (const plugin of current) {
    const spec = desiredById.get(plugin.id);
    const fp = typeof plugin.mcpFingerprint === "string" ? plugin.mcpFingerprint : "";
    const dead = plugin.mcpHealth === "gave-up";
    if (!spec || dead || fp !== mcpFingerprint(spec)) {
      await options.unregister(plugin.id);
      removed.push(plugin.id);
      if (spec) toAdd.push(spec);
      continue;
    }
    kept.push(plugin.id);
    desiredById.delete(plugin.id);
  }
  for (const spec of desiredById.values()) {
    toAdd.push(spec);
  }

  const added: string[] = [];
  const parked: string[] = [];
  const failures: { serverName: string; message: string }[] = [];
  for (const spec of toAdd) {
    const id = `mcp:${spec.serverName}`;
    if (options.list().some((p) => p.id === id)) continue;
    const decision = policy.evaluate({
      kind: "mcp.connect",
      serverId: spec.serverName,
    });
    if (decision.verdict !== "allow") {
      parked.push(spec.serverName);
      continue;
    }
    try {
      const plugin = await connectOneMcpPlugin(
        spec,
        policy,
        hooks,
        options.imageAdmission,
        options.workspaceRoot,
      );
      options.register(plugin);
      added.push(plugin.id);
    } catch (err) {
      failures.push({
        serverName: spec.serverName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await syncMcpResourcePlugin({
    list: options.list,
    ...(options.retained ? { retained: options.retained } : {}),
    register: options.register,
    unregister: options.unregister,
  });

  return { failures, parked, added, removed, kept };
}
