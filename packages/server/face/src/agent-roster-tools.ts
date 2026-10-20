/**
 * Model-facing team_list / team_save / team_import / team_ready.
 * Pack import materializes under agent-rosters/packs/ (child-only skills).
 */
import path from "node:path";
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { readSessionEvents } from "@xrkseek/core-session";
import { isAttachmentError } from "@xrkseek/attachment";
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { isAgentTeamSpawnRole } from "./agent-team-roles.js";
import {
  GLOBAL_ROSTER_ID,
  memberIdProblem,
  catalogMemberWriteProblem,
  parseMemberToolPolicy,
  parseRosterScope,
  rosterPublicFields,
  type ListedRosterMember,
} from "./agent-roster-store.js";
import { parseAgentMemberCard } from "./agent-member-card.js";
import {
  loadAgentMemberPack,
  loadAgentMemberPackBytes,
  materializeAgentMemberPack,
  notReadyPackHints,
  type ParseAgentMemberPackResult,
} from "./agent-member-pack.js";
import { captureSessionPlaybook } from "./capture-member-playbook.js";
import { resolveSessionCwd } from "./session-cwd.js";
import { referencedAttachmentIds } from "./session-attachment.js";
import {
  liveRosterCatalog,
  packShareFlowHint,
  rosterScopeVisibility,
  teamListDescription,
} from "./session-tool-copy.js";

function missingMemberHint(
  runtime: FaceRuntime,
  canvasId: string,
  id: string,
  tool: string,
): string {
  const home = runtime.agentRoster.findHome(id);
  if (!home) {
    return `${tool}: unknown or catalog member "${id}" (team_list first)`;
  }
  if (home.scope === "global" || home.rosterWorkspaceId === canvasId) {
    return `${tool}: unknown or catalog member "${id}"`;
  }
  return (
    `${tool}: member "${id}" is workspace-scoped on canvas ${home.rosterWorkspaceId} ` +
    `(not visible here). Open a session in that workspace, or re-import with scope=global.`
  );
}

export interface BindAgentRosterToolsOptions {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
  /** When true, register `team_list` only (no writes). For non-lead 干员. */
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

function resolvePackPath(runtime: FaceRuntime, sessionId: string, raw: string): string {
  const trimmed = raw.trim();
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  return path.resolve(resolveSessionCwd(runtime, sessionId), trimmed);
}

/** `sha256:…` or `attachment:sha256:…` → durable id. */
function parseAttachmentPackId(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^sha256:[a-f0-9]+$/i.test(trimmed)) return trimmed;
  if (/^attachment:/i.test(trimmed)) {
    const id = trimmed.slice("attachment:".length).trim();
    if (/^sha256:[a-f0-9]+$/i.test(id)) return id;
  }
  return undefined;
}

async function loadPackFromArg(
  runtime: FaceRuntime,
  sessionId: string,
  packRaw: string,
): Promise<ParseAgentMemberPackResult> {
  const attachmentId = parseAttachmentPackId(packRaw);
  if (attachmentId) {
    const attachments = runtime.attachments;
    if (!attachments) {
      return { ok: false, error: "attachments unavailable on this Host" };
    }
    const events = readSessionEvents(runtime.store, sessionId);
    if (!referencedAttachmentIds(events).has(attachmentId)) {
      return {
        ok: false,
        error: `attachment ${attachmentId} is not referenced by this session`,
      };
    }
    try {
      const stored = await attachments.readFile(attachmentId);
      return loadAgentMemberPackBytes(Buffer.from(stored.data));
    } catch (err) {
      if (isAttachmentError(err) && err.code === "NOT_FOUND") {
        return { ok: false, error: `attachment ${attachmentId} bytes missing` };
      }
      throw err;
    }
  }
  return loadAgentMemberPack(resolvePackPath(runtime, sessionId, packRaw));
}

function enrichListedMember(
  runtime: FaceRuntime,
  canvasId: string,
  row: ListedRosterMember,
): Record<string, unknown> {
  const rosterWs = row.scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
  const pub = {
    ...rosterPublicFields(row),
    visibility: rosterScopeVisibility(
      row.scope === "global" ? "global" : "workspace",
      rosterWs,
    ),
  };
  if (row.kind !== "advanced" || row.ready) return pub;
  return {
    ...pub,
    ...notReadyPackHints({
      rosterWorkspaceId: rosterWs,
      memberId: row.id,
      productHome: runtime.agentRoster.home,
    }),
  };
}

/** Register team_list / team_save / team_import / team_ready (or list-only). */
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
        .map((row) => enrichListedMember(runtime, workspaceId, row));
      return { content: JSON.stringify({ workspaceId, members }) };
    },
  });

  if (listOnly) return;

  registerTool(tools, {
    name: "team_save",
    description:
      "Mint/update a thin 干员 (always ready). Not propose_skill. Catalog mem_seed_* are read-only — omit id. " +
      "from_session=true fills name/playbook from this chat. scope global|workspace. " +
      "Advanced pack members: use team_import pack= (not team_save). " +
      packShareFlowHint(),
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "mem_ then [A-Za-z0-9][A-Za-z0-9._-]*, max 64 chars. Omit to mint.",
        },
        name: { type: "string" },
        playbook: {
          type: "string",
          description: "Standalone child instructions (max 20000 chars).",
        },
        role: { type: "string" },
        from_session: { type: "boolean" },
        brief: { type: "string" },
        scope: { type: "string", description: "global | workspace (default workspace)" },
        inject: {
          type: "string",
          description: "minimal (default) | subagent",
        },
        tools: {
          type: "object",
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
      if (typeof a.id === "string" && a.id.trim()) {
        const existing = runtime.agentRoster.get(canvasId, a.id.trim());
        if (existing?.kind === "advanced") {
          return {
            content:
              "team_save: refuse — this id is an advanced pack member. " +
              "Prep with team_list envPrep, then team_ready (or import a new pack). Do not downgrade via team_save.",
            isError: true,
          };
        }
      }
      const toolsPolicy = parseMemberToolPolicy(a.tools);
      const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
        name,
        playbook,
        role: isAgentTeamSpawnRole(roleRaw) ? roleRaw : "worker",
        kind: "thin",
        ready: true,
        ...(typeof a.brief === "string" ? { brief: a.brief } : {}),
        ...(a.inject === "subagent" || a.inject === "minimal"
          ? { inject: a.inject }
          : {}),
        ...(toolsPolicy ? { tools: toolsPolicy } : {}),
        ...(typeof a.id === "string" ? { id: a.id } : {}),
      });
      if (!member) {
        return { content: "team_save: name and playbook required", isError: true };
      }
      return {
        content: JSON.stringify({
          workspaceId: scope === "global" ? "global" : canvasId,
          member,
          kind: "thin",
          next: "subagent member_id",
        }),
      };
    },
  });

  registerTool(tools, {
    name: "team_import",
    description: packShareFlowHint(),
    parameters: {
      type: "object",
      properties: {
        card: {
          type: "string",
          description: "Thin JSON (kind xrk-agent-member). Omit when pack is set.",
        },
        pack: {
          type: "string",
          description:
            "Marked pack zip/dir path (cwd-relative OK) or upload id " +
            "(attachment:sha256:… / sha256:… from the chat file handle). Omit when card is set.",
        },
        scope: {
          type: "string",
          description:
            "global | workspace. global = every workspace; workspace = this canvas only. " +
            "Defaults: card→workspace, pack→global (pass workspace for project-only packs).",
        },
      },
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
      const hasCard = typeof a.card === "string" && a.card.trim().length > 0;
      const hasPack = typeof a.pack === "string" && a.pack.trim().length > 0;
      if (hasCard === hasPack) {
        return {
          content: "team_import: set exactly one of card (JSON) or pack (path|attachment id)",
          isError: true,
        };
      }
      // Pack defaults global (shareable); card defaults workspace. Either may override.
      const scope = parseRosterScope(
        a.scope ?? (hasPack ? "global" : "workspace"),
      );
      if (scope === undefined) {
        return { content: 'team_import: scope must be "workspace" or "global"', isError: true };
      }
      const canvasId = ws();
      const rosterWs = scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
      const visibility = rosterScopeVisibility(scope, rosterWs);

      if (hasCard) {
        const parsed = parseAgentMemberCard(a.card);
        if (!parsed.ok) return { content: `team_import: ${parsed.error}`, isError: true };
        const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
          ...parsed.card,
          kind: "thin",
          ready: true,
        });
        if (!member) return { content: "team_import: name and playbook required", isError: true };
        return {
          content: JSON.stringify({
            workspaceId: rosterWs,
            scope,
            visibility,
            member,
            source: "card",
            next: "subagent member_id",
          }),
        };
      }

      const packRaw = String(a.pack);
      const loaded = await loadPackFromArg(runtime, sessionId, packRaw);
      if (!loaded.ok) return { content: `team_import: ${loaded.error}`, isError: true };

      const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
        ...loaded.pack.card,
        kind: "advanced",
        ready: false,
      });
      if (!member) return { content: "team_import: name and playbook required", isError: true };

      const placed = materializeAgentMemberPack(loaded.pack, {
        rosterWorkspaceId: rosterWs,
        memberId: member.id,
        productHome: runtime.agentRoster.home,
      });

      return {
        content: JSON.stringify({
          workspaceId: rosterWs,
          scope,
          visibility,
          member,
          source: "pack",
          pack: packRaw,
          packDir: placed.packDir,
          skillNames: placed.skillNames,
          ready: false,
          ...(placed.envPrep
            ? {
                envPrep: placed.envPrep,
                envHint:
                  "Review envPrep in this parent session, then call team_ready. Do not auto-run untrusted scripts.",
              }
            : {
                envHint: "No env/SETUP.md — call team_ready when the member is configured.",
              }),
          next: "team_ready → subagent member_id (pack skills inject into the child catalog only)",
        }),
      };
    },
  });

  registerTool(tools, {
    name: "team_ready",
    description:
      "Mark an advanced pack 干员 ready after env prep / playbook review. " +
      "Required before subagent member_id when team_list shows not-ready. Thin members stay ready.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "mem_… member id" },
        ready: {
          type: "boolean",
          description: "Default true. Pass false to mark not-ready again.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    presentCall: (args) => ({
      card: "generic",
      title: "team_ready",
      kind: "execute",
      rawInput: args,
    }),
    execute: async (args) => {
      const a = readArgs(args);
      const id = String(a.id ?? "").trim();
      if (!id) return { content: "team_ready: id required", isError: true };
      const canvasId = ws();
      const updated = runtime.agentRoster.setReady(
        canvasId,
        id,
        a.ready === false ? false : true,
      );
      if (!updated) {
        return { content: missingMemberHint(runtime, canvasId, id, "team_ready"), isError: true };
      }
      const listed = runtime.agentRoster.get(canvasId, updated.id);
      return {
        content: JSON.stringify({
          member: listed ? enrichListedMember(runtime, canvasId, listed) : updated,
          next: updated.ready ? "subagent member_id" : "configure then team_ready again",
        }),
      };
    },
  });
}
