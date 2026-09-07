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

export interface SettingsToolsOptions {
  get?: (ns: string | undefined) => Promise<SettingsGetResult>;
  mutate?: (
    ns: string,
    ops: readonly SettingsPathOp[],
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

/** Read Host Settings namespaces (global ~/.xrk — same as Settings UI). */
export function createSettingsGetTool(options: SettingsToolsOptions): ToolDefinition {
  return {
    name: SETTINGS_GET,
    description:
      "Read Host Settings (global product config under ~/.xrk — same namespaces as Settings UI). " +
      "Omit ns to list namespaces; pass ns (e.g. mcp, bash, llm-deepseek, permission, agent-presets) for the current value. " +
      "Does not return credential secret values.",
    parameters: {
      type: "object",
      properties: {
        ns: {
          type: "string",
          description:
            "Settings namespace (mcp, bash, locale, ui-theme, permission, agent-presets, agent-default-model, llm-deepseek, llm-pi-ai, agent-loop, …). Omit to list.",
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
      const nsRaw = (args as { ns?: unknown }).ns;
      const ns =
        typeof nsRaw === "string" && nsRaw.trim() ? nsRaw.trim() : undefined;
      if (!options.get) {
        return {
          content: `${SETTINGS_GET} unavailable (no Face channel)`,
          isError: true,
        };
      }
      const out = await options.get(ns);
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
 * Mutate Host Settings (global — same as Settings UI Save).
 * For ns=mcp, Host remounts and this waits until connect finishes.
 */
export function createSettingsMutateTool(
  options: SettingsToolsOptions,
): ToolDefinition {
  return {
    name: SETTINGS_MUTATE,
    description:
      "Change Host Settings (global ~/.xrk — same as Settings UI). " +
      "Use path ops: set/unset. Examples: ui-theme.preference light|dark|system (live appearance), " +
      "mcp.servers (add/edit/remove MCP, args, cwd, proxy env HTTP_PROXY/HTTPS_PROXY/NO_PROXY), " +
      "mcp.allowConnect, bash.maxOutputBytes, permission.defaultPreset, llm-deepseek.baseURL, agent-presets.default. " +
      "Secrets: use Credentials UI / credentials tools — do not put API keys in mcp.servers env (proxy keys only). " +
      "Most namespaces apply live; for MCP, waits until remount/connect finishes; connect failures return isError.",
    parameters: {
      type: "object",
      properties: {
        ns: {
          type: "string",
          description: "Settings namespace to mutate.",
        },
        ops: {
          type: "array",
          description: 'Path operations: { op:"set"|"unset", path:["field",...], value? }',
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
      const a = args as { ns?: unknown; ops?: unknown };
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
      const out = await options.mutate(ns, ops);
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
