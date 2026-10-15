/**
 * session.tools — Face RPC: live tool catalog for the session agent.
 * Groups preset/builtin vs MCP (`mcp__*`); surfaces split filesystem / shell / …
 * No absolute paths on tool rows; cwd label is on the envelope.
 */

import path from "node:path";
import { parsePublicToolName } from "@xrkseek/mcp";
import { effectiveSessionAgentPreset } from "./session-agent-preset.js";
import { resolveSessionCwd } from "./session-cwd.js";
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
}

/** `session.tools` response value. */
export interface SessionToolsValue {
  readonly agentPreset: string;
  readonly cwd: string;
  readonly workspaceLabel: string;
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
  "agent_roster",
  "spawn_agent",
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

function classifySurface(
  name: string,
  group: SessionToolGroup,
): SessionToolSurface {
  if (group === "mcp") return "mcp";
  if (FILESYSTEM.has(name) || /^(read_|write_|list_|glob_|grep)/.test(name)) {
    return "filesystem";
  }
  if (SHELL.has(name) || name.startsWith("bash")) return "shell";
  if (BROWSER.has(name) || name.startsWith("browser")) return "browser";
  if (WEB.has(name) || name.startsWith("web_")) return "web";
  if (
    AGENT.has(name) ||
    name.startsWith("team_") ||
    name.startsWith("subagent") ||
    name.startsWith("agent_")
  ) {
    return "agent";
  }
  if (
    MEDIA.has(name) ||
    name.startsWith("image_") ||
    name.startsWith("video_") ||
    name.startsWith("voice")
  ) {
    return "media";
  }
  if (SETTINGS.has(name) || name.startsWith("settings_")) return "settings";
  if (UI.has(name) || name.startsWith("todo_") || name.startsWith("ask_")) {
    return "ui";
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
      error: { code: "session-not-found", message: sessionId },
    };
  }

  const cwd = resolveSessionCwd(runtime, sessionId);
  const agent = await runtime.resolveAgent(sessionId);
  runtime.bindSessionAgent(sessionId, agent);
  const listed = agent.tools?.list() ?? [];
  const tools: SessionToolEntry[] = listed
    .filter((t) => (t.exposure ?? "direct") !== "hidden")
    .map((t) => {
      const { group, surface, mcpServer } = classifyTool(t.name);
      return {
        name: t.name,
        description: t.description,
        group,
        surface,
        ...(mcpServer ? { mcpServer } : {}),
        exposure: t.exposure ?? "direct",
      };
    })
    .sort((a, b) => {
      if (a.group !== b.group) return a.group === "preset" ? -1 : 1;
      if (a.surface !== b.surface) return a.surface.localeCompare(b.surface);
      return a.name.localeCompare(b.name);
    });

  return {
    ok: true,
    value: {
      agentPreset: effectiveSessionAgentPreset(runtime, sessionId),
      cwd,
      workspaceLabel: path.basename(cwd) || cwd,
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
