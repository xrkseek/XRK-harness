/**
 * Host MCP wiring: env `XRK_MCP_SERVERS` (+ optional `XRK_MCP_ALLOW=1`).
 * Registers each connected server as a synthetic `kind: tools` plugin.
 * Face `mcp.servers` in `~/.xrk/host-settings.json` apply when env/config
 * are empty — including live reconcile after `settings.mutate` (no spawn restart).
 */

import { readFileSync } from "node:fs";
import {
  parseMcpServersJson,
  parseMcpServersValue,
} from "@xrkseek/server-config";
import {
  createMcpClient,
  mcpToolDefinition,
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
    }
  | {
      readonly serverName: string;
      readonly url: string;
      readonly requestInit?: RequestInit;
    };

/** Face draft shape (no env) → Host stdio/http specs. */
export type McpServerDraft = {
  readonly serverName: string;
  readonly command?: string;
  readonly url?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
};

/** Plugin carrying supervisor health + desired-spec fingerprint for reconcile. */
export type McpRegisteredPlugin = RegisteredPlugin & {
  mcpHealth: McpConnectionStatus;
  mcpFingerprint: string;
};

function rowToSpec(row: {
  readonly serverName: string;
  readonly command?: string;
  readonly url?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
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
 * Face dump `{ mcp.servers }` / root `mcpServers` → Host specs. Env maps in the
 * file are ignored (secrets stay in process env / credentials). Missing → [].
 */
export function readMcpServersFromHostSettings(
  file: string,
): readonly McpServerSpec[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const root = parsed as {
    mcp?: { servers?: unknown };
    mcpServers?: unknown;
  };
  const servers = root.mcp?.servers ?? root.mcpServers;
  if (servers === undefined) return [];
  return mcpDraftsToSpecs(
    parseMcpServersValue(servers).map((row) => ({
      serverName: row.serverName,
      ...(row.url ? { url: row.url } : {}),
      ...(row.command ? { command: row.command } : {}),
      ...(row.args ? { args: [...row.args] } : {}),
      ...(row.cwd ? { cwd: row.cwd } : {}),
    })),
  );
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
  return plugin.id.startsWith("mcp:");
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
          ...(spec.cwd ? { cwd: spec.cwd } : {}),
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
  readonly onToolsChanged?: (serverName: string) => void | Promise<void>;
  readonly onHealthChanged?: (
    serverName: string,
    status: McpConnectionStatus,
  ) => void | Promise<void>;
  readonly imageAdmission?: import("@xrkseek/mcp").McpImageAdmission;
}): Promise<ReconcileMcpResult> {
  const policy = connectPolicy(options.policy, Boolean(options.allowConnect));
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
  const failures: { serverName: string; message: string }[] = [];
  for (const spec of toAdd) {
    const id = `mcp:${spec.serverName}`;
    if (options.list().some((p) => p.id === id)) continue;
    try {
      const plugin = await connectOneMcpPlugin(
        spec,
        policy,
        hooks,
        options.imageAdmission,
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

  return { failures, added, removed, kept };
}
