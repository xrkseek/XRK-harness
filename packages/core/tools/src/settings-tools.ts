import type { ToolDefinition } from "./definition.js";

export const SETTINGS_GET = "settings_get";
export const SETTINGS_MUTATE = "settings_mutate";

export interface SettingsPathOp {
  readonly op: "set" | "unset";
  readonly path: readonly string[];
  readonly value?: unknown;
}

export interface SettingsGetResult {
  readonly ok: boolean;
  readonly message: string;
  readonly payload?: unknown;
}

export interface SettingsMutateResult {
  readonly ok: boolean;
  readonly message: string;
  readonly applies?: "live" | "restart";
  readonly payload?: unknown;
  /** When ns=mcp: connect failures after remount. */
  readonly failures?: readonly {
    readonly serverName: string;
    readonly message: string;
  }[];
}

/** Optional scope for ns=mcp (Xiangyang dual-layer). */
export type SettingsMcpScope = "global" | "workspace";

export interface SettingsToolCallOpts {
  readonly scope?: SettingsMcpScope;
  readonly workspaceId?: string;
}

export interface SettingsToolsOptions {
  get?: (
    ns: string | undefined,
    opts?: SettingsToolCallOpts,
  ) => Promise<SettingsGetResult>;
  mutate?: (
    ns: string,
    ops: readonly SettingsPathOp[],
    opts?: SettingsToolCallOpts,
  ) => Promise<SettingsMutateResult>;
}

function parseOps(raw: unknown): SettingsPathOp[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "ops must be a non-empty array";
  }
  const out: SettingsPathOp[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return "each op must be an object";
    const r = row as Record<string, unknown>;
    const op = r.op === "unset" ? "unset" : r.op === "set" ? "set" : null;
    if (!op) return 'op must be "set" or "unset"';
    const path = Array.isArray(r.path)
      ? r.path.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (path.length === 0) return "path must be a non-empty string array";
    if (op === "set") {
      out.push({ op, path, value: r.value });
    } else {
      out.push({ op, path });
    }
  }
  return out;
}

function parseCallOpts(args: Record<string, unknown>): SettingsToolCallOpts {
  const scopeRaw = args.scope;
  const scope =
    scopeRaw === "workspace" || scopeRaw === "global" ? scopeRaw : undefined;
  const workspaceId =
    typeof args.workspaceId === "string" && args.workspaceId.trim()
      ? args.workspaceId.trim()
      : undefined;
  return {
    ...(scope ? { scope } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

/** Read Host Settings namespaces (global ~/.xrk — same as Settings UI). */
export function createSettingsGetTool(options: SettingsToolsOptions): ToolDefinition {
  return {
    name: SETTINGS_GET,
    description:
      "Read Host Settings (Settings UI namespaces). Omit ns to list. " +
      "ns=mcp: scope=global (default) or scope=workspace + workspaceId " +
      "(project or agent-home `.xrk/mcp.json`). Bound only on Xiangyang — else route or use UI. " +
      "No credential secret values.",
    parameters: {
      type: "object",
      properties: {
        ns: {
          type: "string",
          description:
            "Settings namespace (e.g. mcp, bash, llm-deepseek). Omit to list.",
        },
        scope: {
          type: "string",
          description:
            'ns=mcp only: "global" (host-settings) or "workspace" (.xrk/mcp.json).',
        },
        workspaceId: {
          type: "string",
          description:
            "Required when scope=workspace — Face workspace id (project or agent-home).",
        },
      },
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Settings get${(args as { ns?: string }).ns ? `: ${(args as { ns?: string }).ns}` : ""}`,
      kind: "other",
      rawInput: args,
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: "Settings",
      content: [{ type: "text" as const, text: result.content }],
    }),
    async execute(args) {
      const a = args as Record<string, unknown>;
      const nsRaw = a.ns;
      const ns =
        typeof nsRaw === "string" && nsRaw.trim() ? nsRaw.trim() : undefined;
      if (!options.get) {
        return {
          content: `${SETTINGS_GET} unavailable (no Face channel)`,
          isError: true,
        };
      }
      const out = await options.get(ns, parseCallOpts(a));
      if (!out.ok) return { content: out.message, isError: true };
      const body =
        out.payload === undefined
          ? out.message
          : `${out.message}\n${JSON.stringify(out.payload, null, 2)}`;
      return { content: body };
    },
  };
}

/**
 * Mutate Host Settings (same as Settings UI Save).
 * Global MCP remount waits until connect finishes.
 * scope=workspace → that root's `.xrk/mcp.json` (project or agent-home).
 */
export function createSettingsMutateTool(
  options: SettingsToolsOptions,
): ToolDefinition {
  return {
    name: SETTINGS_MUTATE,
    description:
      "Change Host Settings (same as UI Save). ops: set|unset with path (+ value). " +
      "ns=mcp: scope=global → host-settings; scope=workspace + workspaceId → that root's " +
      "`.xrk/mcp.json` (project or agent-home — member-private → home id, not global). " +
      "Secrets → Credentials (not mcp.servers env). Most ns live; global MCP waits remount/connect. " +
      "Bound only on Xiangyang — do not invent these tools on other seats.",
    parameters: {
      type: "object",
      properties: {
        ns: {
          type: "string",
          description: "Settings namespace to mutate (e.g. mcp, ui-theme, bash).",
        },
        scope: {
          type: "string",
          description:
            'ns=mcp only: "global" (host-settings) or "workspace" (.xrk/mcp.json).',
        },
        workspaceId: {
          type: "string",
          description:
            "Required when scope=workspace — Face workspace id (project or agent-home).",
        },
        ops: {
          type: "array",
          description:
            'Path ops only: [{ op:"set"|"unset", path:["field",...], value? }]. ' +
            'Not a bare { servers: … } body — wrap under ops with path ["servers"]. ' +
            'Workspace scope: path ["servers"] or ["denyGlobal"].',
          items: {
            type: "object",
            properties: {
              op: { type: "string" },
              path: { type: "array", items: { type: "string" } },
              value: {},
            },
            required: ["op", "path"],
          },
        },
      },
      required: ["ns", "ops"],
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Settings mutate: ${(args as { ns?: string }).ns ?? "?"}`,
      kind: "other",
      rawInput: args,
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: "Settings mutate",
      content: [{ type: "text" as const, text: result.content }],
    }),
    async execute(args) {
      const a = args as Record<string, unknown>;
      const ns = typeof a.ns === "string" ? a.ns.trim() : "";
      if (!ns) {
        return { content: `${SETTINGS_MUTATE}: ns required`, isError: true };
      }
      const ops = parseOps(a.ops);
      if (typeof ops === "string") {
        return { content: `${SETTINGS_MUTATE}: ${ops}`, isError: true };
      }
      if (!options.mutate) {
        return {
          content: `${SETTINGS_MUTATE} unavailable (no Face channel)`,
          isError: true,
        };
      }
      const out = await options.mutate(ns, ops, parseCallOpts(a));
      const parts = [out.message];
      if (out.failures && out.failures.length > 0) {
        parts.push(
          `Connect failures: ${out.failures
            .map((f) => `${f.serverName}: ${f.message}`)
            .join("; ")}`,
        );
      }
      if (out.applies === "restart") {
        parts.push("applies: restart (Host restart may be required)");
      }
      if (out.payload !== undefined) {
        parts.push(JSON.stringify(out.payload, null, 2));
      }
      if (!out.ok || (out.failures && out.failures.length > 0)) {
        return { content: parts.join("\n"), isError: true };
      }
      return { content: parts.join("\n") };
    },
  };
}

export function createSettingsTools(
  options: SettingsToolsOptions = {},
): ToolDefinition[] {
  return [createSettingsGetTool(options), createSettingsMutateTool(options)];
}
