/**
 * Face bind for agent Host Settings tools (Xiangyang only).
 * ns=mcp: scope=global|workspace (+ workspaceId for project or agent-home).
 */

import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import {
  createSettingsTools,
  type SettingsPathOp,
  type SettingsToolCallOpts,
} from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import { formatToolError } from "./face-error-text.js";
import { mcpWorkspaceGet, mcpWorkspaceSet } from "./mcp-workspace-face.js";
import { FACE_PRODUCT_SETTINGS_NAMESPACES } from "./settings-schemas.js";
import {
  settingsDescribeFace,
  settingsMutateFace,
} from "./settings-credentials.js";

const AGENT_SETTINGS_NS = new Set(
  FACE_PRODUCT_SETTINGS_NAMESPACES.map((s) => s.ns),
);

/** The Face-bound instances already installed on a registry (identity guard). */
const faceBound = new WeakSet<ToolDefinition>();

function workspaceIdRequired(
  opts: SettingsToolCallOpts | undefined,
): string | { readonly error: string } {
  const id = opts?.workspaceId?.trim() ?? "";
  if (!id) {
    return {
      error: 'scope=workspace requires workspaceId (Face project workspace id)',
    };
  }
  return id;
}

export function bindSettingsTools(
  tools: ToolRegistry,
  runtime: FaceRuntime,
): void {
  const bound = createSettingsTools({
    async get(ns, opts) {
      if (ns === "mcp" && opts?.scope === "workspace") {
        const ws = workspaceIdRequired(opts);
        if (typeof ws === "object") {
          return { ok: false, message: ws.error };
        }
        const got = await mcpWorkspaceGet(runtime, { workspaceId: ws });
        if (!got.ok) {
          return { ok: false, message: formatToolError(got.error) };
        }
        return {
          ok: true,
          message: `ns=mcp scope=workspace workspaceId=${ws}`,
          payload: got.value,
        };
      }
      const described = await settingsDescribeFace(runtime);
      if (!described.ok) {
        return { ok: false, message: formatToolError(described.error) };
      }
      const namespaces = (described.value as { namespaces?: unknown[] })
        .namespaces;
      if (!Array.isArray(namespaces)) {
        return { ok: false, message: "settings.describe returned no namespaces" };
      }
      if (!ns) {
        return {
          ok: true,
          message:
            "Host Settings namespaces (Xiangyang). mcp: scope=global|workspace",
          payload: namespaces.map((row) => {
            const r = row as { ns?: string; applies?: string; note?: string };
            return {
              ns: r.ns,
              applies: r.applies,
              ...(r.note ? { note: r.note } : {}),
            };
          }),
        };
      }
      if (!AGENT_SETTINGS_NS.has(ns)) {
        return {
          ok: false,
          message: `unknown or non-product ns "${ns}"; use settings_get without ns to list`,
        };
      }
      const hit = namespaces.find(
        (row) => (row as { ns?: string }).ns === ns,
      );
      if (!hit) {
        return { ok: false, message: `ns=${ns} not in describe` };
      }
      return {
        ok: true,
        message: `ns=${ns}`,
        payload: hit,
      };
    },
    async mutate(ns, ops, opts) {
      if (!AGENT_SETTINGS_NS.has(ns)) {
        return {
          ok: false,
          message: `unknown or non-product ns "${ns}"`,
        };
      }
      if (ns === "mcp" && opts?.scope === "workspace") {
        const ws = workspaceIdRequired(opts);
        if (typeof ws === "object") {
          return { ok: false, message: ws.error };
        }
        const prev = await mcpWorkspaceGet(runtime, { workspaceId: ws });
        if (!prev.ok) {
          return { ok: false, message: formatToolError(prev.error) };
        }
        let servers = [...prev.value.servers];
        let denyGlobal = [...prev.value.denyGlobal];
        for (const op of ops) {
          const head = op.path[0];
          if (head === "servers") {
            if (op.op === "unset") servers = [];
            else if (Array.isArray(op.value)) {
              servers = op.value as typeof servers;
            } else {
              return {
                ok: false,
                message: 'workspace mcp: path ["servers"] value must be an array',
              };
            }
          } else if (head === "denyGlobal") {
            if (op.op === "unset") denyGlobal = [];
            else if (Array.isArray(op.value)) {
              denyGlobal = op.value.filter(
                (x): x is string => typeof x === "string",
              );
            } else {
              return {
                ok: false,
                message:
                  'workspace mcp: path ["denyGlobal"] value must be a string array',
              };
            }
          } else {
            return {
              ok: false,
              message:
                'workspace mcp only accepts path ["servers"] or ["denyGlobal"]',
            };
          }
        }
        const set = await mcpWorkspaceSet(runtime, {
          workspaceId: ws,
          servers,
          denyGlobal,
        });
        if (!set.ok) {
          return { ok: false, message: formatToolError(set.error) };
        }
        return {
          ok: true,
          message: `settings.mutate ns=mcp scope=workspace workspaceId=${ws} ok`,
          payload: set.value,
          applies: "live",
        };
      }
      const result = await settingsMutateFace(runtime, {
        ns,
        ops: ops.map((op: SettingsPathOp) =>
          op.op === "unset"
            ? { op: "unset" as const, path: [...op.path] }
            : { op: "set" as const, path: [...op.path], value: op.value },
        ),
      });
      if (!result.ok) {
        return { ok: false, message: formatToolError(result.error) };
      }
      const value = result.value as {
        applies?: "live" | "restart";
        value?: {
          connectFailures?: { serverName: string; message: string }[];
          parked?: string[];
          allowConnect?: boolean;
        };
      };
      const failures = value.value?.connectFailures ?? [];
      const parked = value.value?.parked ?? [];
      const parts = [`settings.mutate ns=${ns} ok`];
      if (ns === "mcp") {
        parts.push(
          `allowConnect=${value.value?.allowConnect === true ? "yes" : "no"}`,
        );
        if (parked.length > 0) parts.push(`parked: ${parked.join(", ")}`);
      }
      return {
        ok: true,
        message: parts.join(". "),
        payload: value.value ?? value,
        ...(value.applies !== undefined ? { applies: value.applies } : {}),
        ...(failures.length > 0 ? { failures } : {}),
      };
    },
  });

  for (const tool of bound) {
    const prev = tools.get(tool.name);
    // Same identity rule as presence_set — see presence-tools.ts.
    if (prev && faceBound.has(prev)) continue;
    // Replace stub `settings_*` (registered by presets/standing tools with no
    // Face impl) instead of skipping: getTool() serves the standing registry
    // first, and its stub returns "unavailable (no Face channel)".
    if (prev) {
      faceBound.add(tool);
      tools.replace(tool);
      continue;
    }
    faceBound.add(tool);
    tools.register(tool);
  }
}
