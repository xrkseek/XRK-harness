/**
 * Model-facing canvas_* tools — workspace-scoped, not session-scoped.
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import {
  isValidCanvasId,
  normalizeSections,
  type CanvasDocument,
  type CanvasSection,
} from "./canvas-store.js";
import { resolveSessionCwd } from "./session-cwd.js";

export interface BindCanvasToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
}

function registerTool(tools: ToolRegistry, tool: ToolDefinition): void {
  if (tools.get(tool.name)) tools.replace(tool);
  else tools.register(tool);
}

function workspaceIdForSession(runtime: FaceRuntime, sessionId: string): string {
  const mapped = runtime.workspaces.workspaceIdOf(sessionId);
  if (mapped) return mapped;
  const cwd = resolveSessionCwd(runtime, sessionId);
  const byPath = runtime.workspaces.findByPath(cwd);
  if (byPath) return byPath.workspaceId;
  return runtime.workspaces.defaultId();
}

function compactDoc(doc: CanvasDocument): unknown {
  return {
    id: doc.id,
    title: doc.title,
    revision: doc.revision,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    sections: doc.sections,
    pathHint: `{XRK_HOME}/canvases/<workspaceId>/${doc.id}.json`,
  };
}

function readArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

/** Register canvas_list / canvas_read / canvas_upsert / canvas_patch / canvas_delete. */
export function bindCanvasTools(
  tools: ToolRegistry,
  options: BindCanvasToolsOptions,
): void {
  const { runtime, sessionId } = options;
  const ws = () => workspaceIdForSession(runtime, sessionId);

  registerTool(tools, {
    name: "canvas_list",
    description:
      "List workspace Canvases (id, title, updatedAt). Scoped to the current Face workspace — " +
      "survives session create/delete. Prefer this before canvas_read.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({
      card: "generic",
      title: "canvas_list",
      kind: "search",
      rawInput: {},
    }),
    execute: async () => {
      const workspaceId = ws();
      const items = runtime.canvases.list(workspaceId);
      return {
        content: JSON.stringify(
          {
            workspaceId,
            count: items.length,
            items,
            disk: `{XRK_HOME}/canvases/${workspaceId}/<id>.json`,
          },
          null,
          2,
        ),
      };
    },
  });

  registerTool(tools, {
    name: "canvas_read",
    description:
      "Read one workspace Canvas document (declarative sections: markdown/table/kpi/callout/series). " +
      "Use anytime — canvases are workspace-locked, not session-locked.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Canvas id (kebab-case)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "canvas_read",
      kind: "read",
      rawInput: args,
    }),
    execute: async (args) => {
      const id = String(readArgs(args).id ?? "").trim();
      if (!isValidCanvasId(id)) {
        return { content: "canvas_read: invalid id", isError: true };
      }
      const workspaceId = ws();
      const doc = runtime.canvases.get(workspaceId, id);
      if (!doc) {
        return {
          content: `canvas_read: not found (${id}) in workspace ${workspaceId}`,
          isError: true,
        };
      }
      return { content: JSON.stringify(compactDoc(doc), null, 2) };
    },
  });

  registerTool(tools, {
    name: "canvas_upsert",
    description:
      "Create or replace a workspace Canvas. sections[] kinds: markdown|md{body} " +
      "(CommonMark headings/lists/code/tables in the body string — not a nested md AST), " +
      "table{columns,rows}, kpi{items:[{label,value,tone?}]}, " +
      "callout{title?,body,tone?}, series{title,points:[{x,y}],tone?}. " +
      "tone (optional): neutral|good|warn|bad|accent — colors KPI values, callouts, series bars. " +
      "Do not write Canvas JSON via filesystem tools — use this tool.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Stable canvas id (kebab-case)." },
        title: { type: "string" },
        sections: { type: "array", description: "Declarative sections (max 64)." },
      },
      required: ["id", "title", "sections"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "canvas_upsert",
      kind: "edit",
      rawInput: args,
    }),
    execute: async (args) => {
      const a = readArgs(args);
      const id = String(a.id ?? "").trim();
      const title = String(a.title ?? "").trim();
      if (!isValidCanvasId(id)) {
        return { content: "canvas_upsert: invalid id", isError: true };
      }
      if (!title) {
        return { content: "canvas_upsert: title required", isError: true };
      }
      const sections = normalizeSections(a.sections);
      try {
        const doc = runtime.canvases.upsert(ws(), { id, title, sections });
        return { content: JSON.stringify(compactDoc(doc), null, 2) };
      } catch (err) {
        return {
          content: `canvas_upsert: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  });

  registerTool(tools, {
    name: "canvas_patch",
    description:
      "Patch an existing workspace Canvas title and/or sections (full sections replace when provided).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        sections: { type: "array" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "canvas_patch",
      kind: "edit",
      rawInput: args,
    }),
    execute: async (args) => {
      const a = readArgs(args);
      const id = String(a.id ?? "").trim();
      if (!isValidCanvasId(id)) {
        return { content: "canvas_patch: invalid id", isError: true };
      }
      const patch: {
        title?: string;
        sections?: CanvasSection[];
      } = {};
      if (typeof a.title === "string") patch.title = a.title;
      if (a.sections !== undefined) patch.sections = normalizeSections(a.sections);
      if (patch.title === undefined && patch.sections === undefined) {
        return { content: "canvas_patch: title or sections required", isError: true };
      }
      try {
        const doc = runtime.canvases.patch(ws(), id, patch);
        return { content: JSON.stringify(compactDoc(doc), null, 2) };
      } catch (err) {
        return {
          content: `canvas_patch: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  });

  registerTool(tools, {
    name: "canvas_delete",
    description: "Delete one workspace Canvas by id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "canvas_delete",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args) => {
      const id = String(readArgs(args).id ?? "").trim();
      if (!isValidCanvasId(id)) {
        return { content: "canvas_delete: invalid id", isError: true };
      }
      const workspaceId = ws();
      const ok = runtime.canvases.delete(workspaceId, id);
      if (!ok) {
        return {
          content: `canvas_delete: not found (${id})`,
          isError: true,
        };
      }
      return {
        content: JSON.stringify({ deleted: true, id, workspaceId }, null, 2),
      };
    },
  });
}

export { workspaceIdForSession as canvasWorkspaceIdForSession };
