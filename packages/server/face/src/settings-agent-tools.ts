/**
 * Face bind for agent Host Settings tools (global ~/.xrk — Settings UI path).
 */

import type { ToolRegistry } from "@xrkseek/core-tools";
import {
  createSettingsTools,
  type SettingsPathOp,
} from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import { FACE_PRODUCT_SETTINGS_NAMESPACES } from "./settings-schemas.js";
import {
  settingsDescribeFace,
  settingsMutateFace,
} from "./settings-credentials.js";

const AGENT_SETTINGS_NS = new Set(
  FACE_PRODUCT_SETTINGS_NAMESPACES.map((s) => s.ns),
);

export function bindSettingsTools(
  tools: ToolRegistry,
  runtime: FaceRuntime,
): void {
  const bound = createSettingsTools({
    async get(ns) {
      const described = await settingsDescribeFace(runtime);
      if (!described.ok) {
        return { ok: false, message: described.error.message };
      }
      const namespaces = (described.value as { namespaces?: unknown[] })
        .namespaces;
      if (!Array.isArray(namespaces)) {
        return { ok: false, message: "settings.describe returned no namespaces" };
      }
      if (!ns) {
        return {
          ok: true,
          message: "Host Settings namespaces (global ~/.xrk)",
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
    async mutate(ns, ops) {
      if (!AGENT_SETTINGS_NS.has(ns)) {
        return {
          ok: false,
          message: `unknown or non-product ns "${ns}"`,
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
        return { ok: false, message: result.error.message };
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
    if (tools.get(tool.name)) tools.replace(tool);
    else tools.register(tool);
  }
}
