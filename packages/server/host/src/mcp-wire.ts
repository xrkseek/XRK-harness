/**
 * Host MCP wiring: env `XRK_MCP_SERVERS` (+ optional `XRK_MCP_ALLOW=1`).
 * Registers each connected server as a synthetic `kind: tools` plugin.
 */

import {
  createMcpClient,
  mcpToolDefinition,
  type McpClient,
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
}): Promise<readonly RegisteredPlugin[]> {
  if (options.specs.length === 0) return [];
  const policy = connectPolicy(options.policy, Boolean(options.allowConnect));
  const plugins: RegisteredPlugin[] = [];

  try {
    for (const spec of options.specs) {
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
              await options.onToolsChanged?.(spec.serverName);
            } catch {
              /* keep previous generation */
            }
          });
          return refresh;
        });
        plugins.push({
          id: `mcp:${spec.serverName}`,
          kind: "tools",
          tools,
          async dispose() {
            unsub();
            await client.dispose();
          },
        });
      } catch (err) {
        await client.dispose();
        throw err;
      }
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
