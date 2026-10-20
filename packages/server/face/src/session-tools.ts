/**
 * session.tools — Face RPC: live tool catalog for the session agent.
 * Groups preset/builtin vs MCP (`mcp__*`); surfaces split filesystem / shell / …
 * No absolute paths on tool rows; cwd label is on the envelope.
 */

import path from "node:path";
import { parsePublicToolName } from "@xrkseek/mcp";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveSessionCwd } from "./session-cwd.js";
import { sessionNotFoundMessage } from "./face-error-text.js";
import { asRecord, type FaceHandler } from "./handlers/types.js";

/** Wire group for one catalog row. */
export type SessionToolGroup = "preset" | "mcp";

/**
 * Coarse tool surface for UI chips (preset buckets + mcp).
 * Kept stable for Settings catalogs — not a permission gate.
 */
export type SessionToolSurface =
  | "filesystem"
  | "shell"
  | "browser"
  | "web"
  | "mcp"
  | "agent"
  | "media"
  | "settings"
  | "ui"
  /** Host / product system tools (skill, memory, cron, lsp, …) — not "other". */
  | "system"
  /** workspace_list / workspace_create — not peer messaging. */
  | "workspace"
  | "other";

/** One tool row on `session.tools`. */
export interface SessionToolEntry {
  readonly name: string;
  readonly description: string;
  readonly group: SessionToolGroup;
  readonly surface: SessionToolSurface;
  /** MCP server id when `group` is `mcp`. */
  readonly mcpServer?: string;
  readonly exposure: "direct" | "deferred" | "hidden";
  /**
   * Whether this tool is on the model wire right now.
   * Direct always true; deferred true only after `tool_search` expand.
   */
  readonly onModel: boolean;
}

/** Progressive-disclosure counts for the Runtime catalog. */
export interface SessionToolsDisclosure {
  readonly direct: number;
  readonly deferred: number;
  /** Deferred tools currently expanded onto the model wire. */
  readonly expanded: number;
}

/** `session.tools` response value. */
export interface SessionToolsValue {
  readonly agentPreset: string;
  readonly cwd: string;
  readonly workspaceLabel: string;
  readonly disclosure: SessionToolsDisclosure;
  readonly tools: readonly SessionToolEntry[];
}

const FILESYSTEM = new Set([
  "read_file",
  "write_file",
  "apply_edit",
  "apply_patch",
  "list_dir",
  "glob_file_search",
  "grep",
  "delete_file",
  "move_file",
  "search_replace",
]);

const SHELL = new Set(["bash", "shell", "run_terminal_cmd", "run_code"]);

const BROWSER = new Set([
  "browser",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "computer_use",
]);

const WEB = new Set(["web_search", "web_fetch", "fetch_url"]);

const AGENT = new Set([
  "subagent",
  "team_list",
  "team_create",
  "team_save",
  "team_import",
  "team_ready",
  "team_remove",
  "team_export",
  "team_self",
  "team_graph",
  "agent_roster",
  "spawn_agent",
  "list_agents",
  "send_message",
  "followup_task",
  "wait_agent",
  "interrupt_agent",
  "close_agent",
]);

const MEDIA = new Set([
  "image_generate",
  "video_generate",
  "video_analyze",
  "voice",
  "tts",
  "stt",
]);

const SETTINGS = new Set([
  "settings_read",
  "settings_mutate",
  "credentials_set",
]);

const UI = new Set([
  "ask_user",
  "todo_write",
  "presence",
  "canvas",
  "analytics",
]);

/** Product Host tools that are neither MCP nor a coding surface bucket. */
const SYSTEM = new Set([
  "skill",
  "memory",
  "cronjob",
  "lsp",
  "tool_search",
  "spill_read",
  "working_directory",
  "create_worktree",
]);

function classifySurface(
  name: string,
  group: SessionToolGroup,
): SessionToolSurface {
  if (group === "mcp") return "mcp";
  // Team surface covers spawn plus collaboration: 主线 / 支线 / session
  // search·read·trace / thread_message / presence. Checked before `list_`
  // so `list_agents` is not filed as filesystem.
  if (
    AGENT.has(name) ||
    name.startsWith("team_") ||
    name.startsWith("subagent") ||
    name.startsWith("agent_") ||
    name.endsWith("_agent") ||
    name.startsWith("session_") ||
    name.startsWith("thread_") ||
    name.startsWith("sideline_") ||
    name.startsWith("presence_") ||
    name === "workspace_session_prompt"
  ) {
    return "agent";
  }
  if (name.startsWith("workspace_")) return "workspace";
  if (
    FILESYSTEM.has(name) ||
    name === "glob" ||
    /^(read_|write_|glob_|grep)/.test(name) ||
    name.startsWith("list_")
  ) {
    return "filesystem";
  }
  if (SHELL.has(name) || name.startsWith("bash")) return "shell";
  if (BROWSER.has(name) || name.startsWith("browser")) return "browser";
  if (WEB.has(name) || name.startsWith("web_")) return "web";
  if (
    MEDIA.has(name) ||
    name.startsWith("image_") ||
    name.startsWith("video_") ||
    name.startsWith("voice")
  ) {
    return "media";
  }
  if (SETTINGS.has(name) || name.startsWith("settings_")) return "settings";
  if (
    UI.has(name) ||
    name.startsWith("todo_") ||
    name.startsWith("ask_") ||
    name.startsWith("canvas_") ||
    name.startsWith("goal_") ||
    name.endsWith("_goal")
  ) {
    return "ui";
  }
  if (
    SYSTEM.has(name) ||
    name.startsWith("skill") ||
    name.startsWith("memory") ||
    name.startsWith("cron") ||
    name.startsWith("lsp") ||
    name.startsWith("spill_") ||
    name.endsWith("_skill") ||
    name === "present" ||
    name === "ralph"
  ) {
    return "system";
  }
  return "other";
}

function classifyTool(name: string): {
  readonly group: SessionToolGroup;
  readonly surface: SessionToolSurface;
  readonly mcpServer?: string;
} {
  const mcp = parsePublicToolName(name);
  if (mcp) {
    return { group: "mcp", surface: "mcp", mcpServer: mcp.serverName };
  }
  const group: SessionToolGroup = "preset";
  return { group, surface: classifySurface(name, group) };
}

/**
 * List tools currently registered on the session agent (after Face bind).
 * Requires an attached session; cold ids → `session-not-found`.
 */
export const sessionTools: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
    };
  }

  const cwd = resolveSessionCwd(runtime, sessionId);
  const agent = await runtime.resolveAgent(sessionId);
  runtime.bindSessionAgent(sessionId, agent);
  const listed = agent.tools?.list() ?? [];
  const expanded = runtime.toolDisclosure.listExpanded(sessionId);
  let direct = 0;
  let deferred = 0;
  let expandedCount = 0;
  const tools: SessionToolEntry[] = listed
    .filter((t) => (t.exposure ?? "direct") !== "hidden")
    .map((t) => {
      const { group, surface, mcpServer } = classifyTool(t.name);
      const exposure = t.exposure ?? "direct";
      const onModel =
        exposure === "direct" ||
        (exposure === "deferred" && expanded.has(t.name));
      if (exposure === "direct") direct += 1;
      else if (exposure === "deferred") {
        deferred += 1;
        if (onModel) expandedCount += 1;
      }
      return {
        name: t.name,
        description: t.description,
        group,
        surface,
        ...(mcpServer ? { mcpServer } : {}),
        exposure,
        onModel,
      };
    })
    .sort((a, b) => {
      if (a.group !== b.group) return a.group === "preset" ? -1 : 1;
      if (a.surface !== b.surface) return a.surface.localeCompare(b.surface);
      // On-model first within a surface so progressive disclosure is scannable.
      if (a.onModel !== b.onModel) return a.onModel ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    ok: true,
    value: {
      agentPreset: effectiveSessionAgentPreset(runtime, sessionId),
      cwd,
      workspaceLabel: path.basename(cwd) || cwd,
      disclosure: { direct, deferred, expanded: expandedCount },
      tools,
    } satisfies SessionToolsValue,
  };
};

/** Test helper — classify without a live agent. */
export function classifySessionToolName(name: string): SessionToolGroup {
  return classifyTool(name).group;
}

/** Test helper — surface bucket. */
export function classifySessionToolSurface(name: string): SessionToolSurface {
  return classifyTool(name).surface;
}
