/**
 * Host MCP wiring: env `XRK_MCP_SERVERS` (+ optional `XRK_MCP_ALLOW=1`).
 * Registers each connected server as a synthetic `kind: tools` plugin.
 * Face `mcp.servers` in `{workspace}/.xrk/host-settings.json` apply when env/config
 * are empty — including live reconcile after `settings.mutate` (no spawn restart).
 */

import { readFileSync } from "node:fs";
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

export function parseMcpServersEnv(
  raw: string | undefined,
): readonly McpServerSpec[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("XRK_MCP_SERVERS must be JSON array");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("XRK_MCP_SERVERS must be JSON array");
  }
  const out: McpServerSpec[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const serverName = String(o.serverName ?? "").trim();
    if (!serverName) {
      throw new Error("XRK_MCP_SERVERS entry needs serverName");
    }
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (url) {
      out.push({ serverName, url });
      continue;
    }
    const command = String(o.command ?? "").trim();
    if (!command) {
      throw new Error(
        "XRK_MCP_SERVERS entry needs command (stdio) or url (http)",
      );
    }
    out.push({
      serverName,
      command,
      ...(Array.isArray(o.args)
        ? { args: o.args.map((a) => String(a)) }
        : {}),
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

/**
 * Face dump `{ mcp.servers }` → Host specs. Env maps in the file are ignored
 * (secrets stay in process env / credentials). Missing or malformed → [].
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
  const servers = (parsed as { mcp?: { servers?: unknown } }).mcp?.servers;
  if (!Array.isArray(servers)) return [];
  const drafts: McpServerDraft[] = [];
  for (const row of servers) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const serverName = String(o.serverName ?? "").trim();
    if (!serverName) continue;
    drafts.push({
      serverName,
      ...(typeof o.url === "string" ? { url: o.url.trim() } : {}),
      ...(typeof o.command === "string" ? { command: o.command.trim() } : {}),
      ...(Array.isArray(o.args) ? { args: o.args.map((a) => String(a)) } : {}),
      ...(typeof o.cwd === "string" && o.cwd.trim()
        ? { cwd: o.cwd.trim() }
        : {}),
    });
  }
  return mcpDraftsToSpecs(drafts);
}

/** Convert Face desired drafts into Host connect specs (skips incomplete rows). */
export function mcpDraftsToSpecs(
  drafts: readonly McpServerDraft[],
): McpServerSpec[] {
  const out: McpServerSpec[] = [];
  for (const row of drafts) {
    const serverName = row.serverName.trim();
    if (!serverName) continue;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (url) {
      out.push({ serverName, url });
      continue;
    }
    const command = typeof row.command === "string" ? row.command.trim() : "";
    if (!command) continue;
    out.push({
      serverName,
      command,
      ...(Array.isArray(row.args) ? { args: row.args.map(String) } : {}),
      ...(typeof row.cwd === "string" && row.cwd.trim()
        ? { cwd: row.cwd.trim() }
        : {}),
    });
  }
  return out;
}

/** Stable id for reconcile keep/replace (env intentionally omitted from Face drafts). */
export function mcpFingerprint(spec: McpServerSpec): string {
  if ("url" in spec) {
    return JSON.stringify({ n: spec.serverName, u: spec.url });
  }
  return JSON.stringify({
    n: spec.serverName,
    c: spec.command,
    a: [...(spec.args ?? [])],
    d: spec.cwd ?? "",
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
  onToolsChanged?: (serverName: string) => void | Promise<void>,
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
        })
      : createMcpClient({
          serverName: spec.serverName,
          command: spec.command,
          ...(spec.args ? { args: spec.args } : {}),
          ...(spec.env ? { env: spec.env } : {}),
          ...(spec.cwd ? { cwd: spec.cwd } : {}),
          policy,
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
          await onToolsChanged?.(spec.serverName);
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
      if (state.status !== "gave-up") return;
      tools.splice(0, tools.length);
      void onToolsChanged?.(spec.serverName);
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
}): Promise<readonly McpRegisteredPlugin[]> {
  if (options.specs.length === 0) return [];
  const policy = connectPolicy(options.policy, Boolean(options.allowConnect));
  const plugins: McpRegisteredPlugin[] = [];

  try {
    for (const spec of options.specs) {
      plugins.push(
        await connectOneMcpPlugin(spec, policy, options.onToolsChanged),
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
 * changed, connect additions. Per-server connect failures are collected (other
 * servers still apply).
 */
export async function reconcileMcpToolPlugins(options: {
  readonly desired: readonly McpServerSpec[];
  readonly list: () => readonly RegisteredPlugin[];
  readonly register: (plugin: RegisteredPlugin) => void;
  readonly unregister: (id: string) => Promise<void>;
  readonly policy?: PolicyEngine;
  readonly allowConnect?: boolean;
  readonly onToolsChanged?: (serverName: string) => void | Promise<void>;
}): Promise<ReconcileMcpResult> {
  const policy = connectPolicy(options.policy, Boolean(options.allowConnect));
  const desiredById = new Map<string, McpServerSpec>(
    options.desired.map((spec) => [`mcp:${spec.serverName}`, spec]),
  );
  const current = options.list().filter(isMcpPlugin);
  const removed: string[] = [];
  const kept: string[] = [];
  const toAdd: McpServerSpec[] = [];

  for (const plugin of current) {
    const spec = desiredById.get(plugin.id);
    const fp = typeof plugin.mcpFingerprint === "string" ? plugin.mcpFingerprint : "";
    if (!spec || fp !== mcpFingerprint(spec)) {
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
        options.onToolsChanged,
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
