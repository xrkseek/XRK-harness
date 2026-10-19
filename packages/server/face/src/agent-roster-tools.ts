/**
 * Model-facing team_list / team_save — child's tools, inject, and playbook.
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { isAgentTeamSpawnRole } from "./agent-team-roles.js";
import {
  memberIdProblem,
  catalogMemberWriteProblem,
  parseMemberToolPolicy,
  parseRosterScope,
  rosterPublicFields,
} from "./agent-roster-store.js";
import { parseAgentMemberCard } from "./agent-member-card.js";
import { captureSessionPlaybook } from "./capture-member-playbook.js";
import {
  liveRosterCatalog,
  teamListDescription,
} from "./session-tool-copy.js";

export interface BindAgentRosterToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
  /** When true, register `team_list` only (no `team_save`). For non-lead 干员. */
  readonly listOnly?: boolean;
}

function registerTool(tools: ToolRegistry, tool: ToolDefinition): void {
  if (tools.get(tool.name)) return;
  tools.register(tool);
}

function readArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

/** Register team_list / team_save (or list-only). Spawn stays `subagent` + member_id. */
export function bindAgentRosterTools(
  tools: ToolRegistry,
  options: BindAgentRosterToolsOptions,
): void {
  const { runtime, sessionId, listOnly = false } = options;
  const ws = () => canvasWorkspaceIdForSession(runtime, sessionId);

  registerTool(tools, {
    name: "team_list",
    description: "List Agent Team members (干员) for this workspace + global.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    isConcurrencySafe: () => true,
    presentCall: () => ({
      card: "generic",
      title: "team_list",
      kind: "search",
      rawInput: {},
    }),
    dynamicSchema: () => ({
      description: teamListDescription({
        listOnly,
        catalog: liveRosterCatalog(runtime, sessionId),
      }),
    }),
    execute: async () => {
      const workspaceId = ws();
      const members = runtime.agentRoster
        .listVisible(workspaceId)
        .map(rosterPublicFields);
      return { content: JSON.stringify({ workspaceId, members }) };
    },
  });

  if (listOnly) return;

  registerTool(tools, {
    name: "team_save",
    description:
      "Create or update an Agent Team member (干员 / 成员 / 子代理团队的一员): tools + inject + playbook. " +
      "Use this when the user says 干员, 成员, teammate, or wants someone on the subagent team — not propose_skill, which only writes a SKILL.md. " +
      "Built-in catalog ids (mem_seed_*) cannot be updated — omit id to mint a new role, copying fields from a catalog member if you want that template. " +
      "Use after a repeatable process (release, review, deploy) so later `subagent member_id` " +
      "does not rediscover it. from_session=true fills name/playbook from this chat. " +
      "scope global|workspace. inject minimal (skip home persona + skill catalog) | subagent. " +
      "tools {mode:allow|deny, names:[...]} weakens the parent preset only. " +
      "role worker|researcher|reviewer|lead|default is the deny template under the playbook.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "mem_ then [A-Za-z0-9][A-Za-z0-9._-]*, max 64 chars. " +
            "Omit to mint one. Reuse a previous user-owned id to update that member. Catalog mem_seed_* ids are read-only.",
        },
        name: { type: "string" },
        playbook: {
          type: "string",
          description: "Standalone instructions a later child can run without this chat.",
        },
        role: { type: "string" },
        from_session: {
          type: "boolean",
          description: "If true, mint name/playbook from this session's user+assistant log.",
        },
        brief: { type: "string" },
        scope: {
          type: "string",
          description: "global | workspace (default workspace)",
        },
        inject: {
          type: "string",
          description:
            "minimal (default, skip home persona + skill catalog) | subagent",
        },
        tools: {
          type: "object",
          description:
            "Weaken-only tool policy. {mode:'allow'|'deny', names:['bash','read']}.",
          properties: {
            mode: { type: "string" },
            names: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "team_save",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args) => {
      const a = readArgs(args);
      const idProblem = memberIdProblem(a.id);
      if (idProblem) return { content: `team_save: ${idProblem}`, isError: true };
      const catalogProblem = catalogMemberWriteProblem(a.id);
      if (catalogProblem) return { content: `team_save: ${catalogProblem}`, isError: true };
      const captured = a.from_session === true
        ? captureSessionPlaybook(runtime, sessionId)
        : undefined;
      const name = String(a.name ?? "").trim() || captured?.name || "";
      const playbook = String(a.playbook ?? "").trim() || captured?.playbook || "";
      const roleRaw = typeof a.role === "string" ? a.role : "worker";
      const canvasId = ws();
      const scope = parseRosterScope(a.scope);
      if (scope === undefined) {
        return {
          content: 'team_save: scope must be "workspace" or "global"',
          isError: true,
        };
      }
      const tools = parseMemberToolPolicy(a.tools);
      const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
        name,
        playbook,
        role: isAgentTeamSpawnRole(roleRaw) ? roleRaw : "worker",
        ...(typeof a.brief === "string" ? { brief: a.brief } : {}),
        ...(a.inject === "subagent" || a.inject === "minimal"
          ? { inject: a.inject }
          : {}),
        ...(tools ? { tools } : {}),
        ...(typeof a.id === "string" ? { id: a.id } : {}),
      });
      if (!member) {
        return { content: "team_save: name and playbook required", isError: true };
      }
      return {
        content: JSON.stringify({
          workspaceId: scope === "global" ? "global" : canvasId,
          member,
        }),
      };
    },
  });

  registerTool(tools, {
    name: "team_import",
    description:
      "Import a 干员 from an xrk-agent-member card (JSON). " +
      "Appearance, dressing, and ids are ignored — a new workspace member is minted. " +
      "Use when the user pastes or attaches someone else's exported member.",
    parameters: {
      type: "object",
      properties: {
        card: {
          type: "string",
          description: "JSON object with kind xrk-agent-member, name, playbook, optional brief/role/inject/tools.",
        },
        scope: {
          type: "string",
          description: "global | workspace (default workspace)",
        },
      },
      required: ["card"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "team_import",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args) => {
      const a = readArgs(args);
      const parsed = parseAgentMemberCard(a.card);
      if (!parsed.ok) return { content: `team_import: ${parsed.error}`, isError: true };
      const scope = parseRosterScope(a.scope ?? "workspace");
      if (scope === undefined) {
        return { content: 'team_import: scope must be "workspace" or "global"', isError: true };
      }
      const canvasId = ws();
      const member = runtime.agentRoster.upsertAtScope(canvasId, scope, parsed.card);
      if (!member) return { content: "team_import: name and playbook required", isError: true };
      return {
        content: JSON.stringify({
          workspaceId: scope === "global" ? "global" : canvasId,
          member,
        }),
      };
    },
  });
}
