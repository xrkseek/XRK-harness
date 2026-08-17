/**
 * Host MCP M0 wiring: env `XRK_MCP_SERVERS` (+ optional `XRK_MCP_ALLOW=1`).
 * Registers each connected server as a synthetic `kind: tools` plugin.
 */

import type { ToolDefinition } from "@xrkseek/core-tools";
import {
  createMcpClient,
  publicToolName,
  type McpClient,
} from "@xrkseek/mcp";
import {
  assertPolicyAllow,
  createPolicyEngine,
  type PolicyEngine,
} from "@xrkseek/policy";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

export interface McpServerSpec {
  readonly serverName: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

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
    const command = String(o.command ?? "").trim();
    if (!serverName || !command) {
      throw new Error("XRK_MCP_SERVERS entry needs serverName + command");
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

async function toolsFromClient(client: McpClient): Promise<ToolDefinition[]> {
  const listed = await client.listTools();
  return listed.map((info) => {
    const name = publicToolName(client.serverName, info.name);
    const def: ToolDefinition = {
      name,
      description: info.description || `MCP tool ${info.name}`,
      parameters: info.inputSchema,
      async execute(args, signal) {
        const result = await client.callTool(
          info.name,
          (args ?? {}) as Record<string, unknown>,
          signal,
        );
        return {
          content: result.content,
          ...(result.isError ? { isError: true } : {}),
        };
      },
    };
    return def;
  });
}

/**
 * Connect configured MCP servers; return plugins for loader.register.
 * Callers must dispose via plugin.dispose / loader.unregister.
 */
export async function loadMcpToolPlugins(options: {
  readonly specs: readonly McpServerSpec[];
  readonly policy?: PolicyEngine;
  /** When true (XRK_MCP_ALLOW=1), elevate mcp.connect default to allow. */
  readonly allowConnect?: boolean;
}): Promise<readonly RegisteredPlugin[]> {
  if (options.specs.length === 0) return [];
  const policy = connectPolicy(options.policy, Boolean(options.allowConnect));
  const plugins: RegisteredPlugin[] = [];

  for (const spec of options.specs) {
    assertPolicyAllow(policy, {
      kind: "mcp.connect",
      serverId: spec.serverName,
    });
    const client = createMcpClient({
      serverName: spec.serverName,
      command: spec.command,
      ...(spec.args ? { args: spec.args } : {}),
      ...(spec.env ? { env: spec.env } : {}),
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      policy,
    });
    await client.connect();
    const tools = await toolsFromClient(client);
    plugins.push({
      id: `mcp:${spec.serverName}`,
      kind: "tools",
      tools,
      async dispose() {
        await client.dispose();
      },
    });
  }

  return plugins;
}
