/**
 * Model-facing team_list / save / import / ready / home / export / remove /
 * team_self. Members ≠ 干员家 — only team_home (or UI mintHome) creates homes.
 * Packs under agent-rosters/packs/.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import { readSessionEvents } from "@xrkseek/core-session";
import { isAttachmentError } from "@xrkseek/attachment";
import type { FaceRuntime } from "./context.js";
import { canvasWorkspaceIdForSession } from "./canvas-tools.js";
import { isAgentTeamSpawnRole } from "./agent-team-roles.js";
import {
  GLOBAL_ROSTER_ID,
  MANAGER_MEMBER_ID,
  SUNFLOWER_MEMBER_ID,
  memberIdProblem,
  catalogMemberWriteProblem,
  parseMemberInject,
  parseMemberToolPolicy,
  parseRosterScope,
  rosterPublicFields,
  type AgentRosterMember,
  type ListedRosterMember,
  type MemberInject,
  type MemberToolPolicy,
} from "./agent-roster-store.js";
import {
  parseAgentMemberCard,
  type AgentMemberCard,
} from "./agent-member-card.js";
import {
  AGENT_MEMBER_PACK_LAYOUT,
  MEMBER_PACK_BRIEFCASE,
  buildAgentMemberPackZip,
  collectPackSkillFiles,
  collectPackWorkspaceFiles,
  listMemberPackInventory,
  loadAgentMemberPack,
  loadAgentMemberPackBytes,
  materializeAgentMemberPack,
  mergeIntoMemberPack,
  notReadyPackHints,
  type ParseAgentMemberPackResult,
} from "./agent-member-pack.js";
import {
  adoptLiveMemberIdentityPlaybook,
  publishMemberIdentityPlaybook,
} from "./agent-identity-sync.js";
import { mintAgentHomeForMember } from "./agent-home.js";
import { withAdvancedPackPathGuidance } from "./capture-member-playbook.js";
import { resolveSessionCwd } from "./session-cwd.js";
import { referencedAttachmentIds } from "./session-attachment.js";
import { dispatchFaceMethod } from "./dispatch.js";
import {
  rosterScopeVisibility,
  teamListDescription,
} from "./session-tool-copy.js";
import {
  readSeatTitles,
  readUiLocalePreference,
} from "./seat-titles.js";

function teamPresent(
  title: string,
  kind: "search" | "execute",
  args: unknown = {},
): { card: "generic"; title: string; kind: "search" | "execute"; rawInput: unknown } {
  return { card: "generic", title, kind, rawInput: args };
}

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
  /**
   * When true, skip parent mint/install/remove tools.
   * Pass `selfMemberId` so a named 干员 can still revise its own playbook.
   */
  readonly listOnly?: boolean;
  /**
   * Roster member id for `team_self` under listOnly — delegated
   * `subagent(member_id)` children **and** agent-home identity seats.
   */
  readonly selfMemberId?: string;
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

/** Effective playbook for spawn / export / tool responses (disk mirrors win). */
export function liveMemberPlaybook(
  runtime: FaceRuntime,
  canvasId: string,
  row: AgentRosterMember | ListedRosterMember,
): string {
  const listed: ListedRosterMember =
    "scope" in row ? row : { ...row, scope: "workspace" };
  return adoptLiveMemberIdentityPlaybook(runtime, canvasId, listed).playbook;
}

function enrichListedMember(
  runtime: FaceRuntime,
  canvasId: string,
  row: ListedRosterMember,
): Record<string, unknown> {
  const live = adoptLiveMemberIdentityPlaybook(runtime, canvasId, row);
  const rosterWs = live.scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
  const pub = {
    ...rosterPublicFields(live),
    visibility: rosterScopeVisibility(
      live.scope === "global" ? "global" : "workspace",
      rosterWs,
    ),
  };
  const homeWorkspaceId =
    runtime.workspaces.findAgentHomeByMember(live.id)?.workspaceId;
  const withHome = {
    ...pub,
    ...(homeWorkspaceId ? { homeWorkspaceId } : {}),
  };
  if (live.kind !== "advanced") return withHome;
  const packOpts = {
    rosterWorkspaceId: rosterWs,
    memberId: live.id,
    productHome: runtime.agentRoster.home,
  };
  const inventory = listMemberPackInventory(packOpts);
  const base = {
    ...withHome,
    ...(inventory
      ? {
          packHome: inventory.packHome,
          playbookPath: inventory.playbookPath,
          ...(inventory.envPrepPath
            ? { envPrepPath: inventory.envPrepPath }
            : {}),
          ...(inventory.materialsPath
            ? {
                materialsPath: inventory.materialsPath,
                materialsTop: inventory.materialsTop,
              }
            : {}),
          skills: inventory.skills,
          briefcase: MEMBER_PACK_BRIEFCASE,
        }
      : {}),
  };
  if (live.ready) return base;
  return {
    ...base,
    ...notReadyPackHints(packOpts),
  };
}

function resolveCwdPaths(
  runtime: FaceRuntime,
  sessionId: string,
  rows: unknown,
): string[] {
  const cwd = resolveSessionCwd(runtime, sessionId);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) =>
      path.isAbsolute(s.trim()) ? s.trim() : path.resolve(cwd, s.trim()),
    );
}

/**
 * Mint an advanced pack member (playbook + optional skills/files/env).
 * Shared by team_save — team_import only installs card=/pack=.
 */
function mintAdvancedMember(input: {
  readonly runtime: FaceRuntime;
  readonly sessionId: string;
  readonly canvasId: string;
  readonly scope: "global" | "workspace";
  readonly name: string;
  readonly playbook: string;
  readonly roleRaw: string;
  readonly brief?: string;
  readonly inject?: unknown;
  readonly tools?: unknown;
  readonly envPrep?: string;
  readonly skills?: unknown;
  readonly files?: unknown;
  readonly id?: string;
}):
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly content: string } {
  const {
    runtime,
    sessionId,
    canvasId,
    scope,
    name,
    playbook,
  } = input;
  if (!name.trim() || !playbook.trim()) {
    return {
      ok: false,
      content: "team_save: advanced needs name and playbook (from the real scenario)",
    };
  }
  const toolsPolicy = parseMemberToolPolicy(input.tools);
  if (input.tools !== undefined && input.tools !== null && !toolsPolicy) {
    return {
      ok: false,
      content: 'team_save: tools needs { mode: "allow"|"deny", names: [...] }',
    };
  }
  const card: AgentMemberCard = {
    name: name.trim(),
    playbook: withAdvancedPackPathGuidance(playbook),
    role: isAgentTeamSpawnRole(input.roleRaw) ? input.roleRaw : "worker",
    ...(input.brief?.trim() ? { brief: input.brief.trim() } : {}),
    ...(input.inject === "subagent" || input.inject === "minimal"
      ? { inject: input.inject }
      : {}),
    ...(toolsPolicy ? { tools: toolsPolicy } : {}),
  };
  const skillPaths = resolveCwdPaths(runtime, sessionId, input.skills);
  let skillsFiles: ReadonlyMap<string, Buffer> | undefined;
  if (skillPaths.length > 0) {
    const bundled = collectPackSkillFiles(skillPaths);
    if (!bundled.ok) {
      return { ok: false, content: `team_save: ${bundled.error}` };
    }
    skillsFiles = bundled.files;
  }
  const filePaths = resolveCwdPaths(runtime, sessionId, input.files);
  let workspaceFiles: ReadonlyMap<string, Buffer> | undefined;
  if (filePaths.length > 0) {
    const bundled = collectPackWorkspaceFiles(filePaths);
    if (!bundled.ok) {
      return { ok: false, content: `team_save: ${bundled.error}` };
    }
    workspaceFiles = bundled.files;
  }
  const envPrep = input.envPrep?.trim() || undefined;
  const zip = buildAgentMemberPackZip(card, {
    ...(skillsFiles && skillsFiles.size > 0 ? { skillsFiles } : {}),
    ...(workspaceFiles && workspaceFiles.size > 0 ? { workspaceFiles } : {}),
    ...(envPrep ? { envPrep } : {}),
  });
  const loaded = loadAgentMemberPackBytes(zip);
  if (!loaded.ok) {
    return { ok: false, content: `team_save: ${loaded.error}` };
  }
  const rosterWs = scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
  const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
    ...loaded.pack.card,
    kind: "advanced",
    ready: false,
    ...(input.id?.trim() ? { id: input.id.trim() } : {}),
  });
  if (!member) {
    return { ok: false, content: "team_save: name and playbook required" };
  }
  const placed = materializeAgentMemberPack(loaded.pack, {
    rosterWorkspaceId: rosterWs,
    memberId: member.id,
    productHome: runtime.agentRoster.home,
  });
  return {
    ok: true,
    content: JSON.stringify({
      workspaceId: rosterWs,
      scope,
      visibility: rosterScopeVisibility(scope, rosterWs),
      member,
      source: "team_save",
      kind: "advanced",
      packDir: placed.packDir,
      skillNames: placed.skillNames,
      ready: false,
      ...(placed.envPrep
        ? {
            envPrep: placed.envPrep,
            envHint:
              "Review envPrep here (or hand zip to a friend). Then team_ready. Do not auto-run scripts.",
          }
        : {
            envHint:
              "No env/SETUP.md — team_ready when configured; friend gets playbook (± skills).",
          }),
      next: "team_ready → team_home | subagent member_id",
      layout: AGENT_MEMBER_PACK_LAYOUT,
      pathHint: `${MEMBER_PACK_BRIEFCASE}=pack_home (injected). Spawn cwd=parent workspace.`,
    }),
  };
}

function patchExistingMember(
  runtime: FaceRuntime,
  canvasId: string,
  existing: ListedRosterMember,
  patch: {
    readonly name?: string;
    readonly playbook?: string;
    readonly brief?: string;
    readonly inject?: MemberInject;
    /** `null` clears tools policy (follow role only). */
    readonly tools?: MemberToolPolicy | null;
  },
): ListedRosterMember | undefined {
  const name = (patch.name ?? existing.name).trim();
  const scope = existing.scope === "global" ? "global" : "workspace";
  // Only revise playbook when explicitly passed — omit must not clobber a
  // fresher AGENTS.md / pack playbook.md (adopt heals on read).
  let playbook = (patch.playbook ?? existing.playbook).trim();
  if (existing.kind === "advanced" && patch.playbook !== undefined) {
    playbook = withAdvancedPackPathGuidance(playbook);
  }
  if (!name || !playbook) return undefined;
  const inject = patch.inject ?? existing.inject;
  const tools =
    patch.tools === undefined
      ? existing.tools
      : patch.tools === null
        ? undefined
        : patch.tools;
  const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
    id: existing.id,
    name,
    playbook,
    role: isAgentTeamSpawnRole(existing.role) ? existing.role : "worker",
    kind: existing.kind,
    ready: existing.ready,
    brief: patch.brief !== undefined ? patch.brief : existing.brief,
    inject,
    ...(tools ? { tools } : patch.tools === null ? { tools: null } : {}),
    appearance: existing.appearance,
  });
  if (!member) return undefined;
  if (patch.playbook !== undefined) {
    publishMemberIdentityPlaybook(runtime, {
      memberId: member.id,
      playbook: member.playbook,
      source: "roster",
    });
  }
  return runtime.agentRoster.get(canvasId, member.id);
}

/** Register team_list / team_save / team_import / team_ready / team_remove (or list + team_self). */
export function bindAgentRosterTools(
  tools: ToolRegistry,
  options: BindAgentRosterToolsOptions,
): void {
  const { runtime, sessionId, listOnly = false } = options;
  const selfMemberId = options.selfMemberId?.trim() || undefined;
  const ws = () => canvasWorkspaceIdForSession(runtime, sessionId);

  registerTool(tools, {
    name: "team_list",
    description: "List Agent Team members (干员) for this workspace + global.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    isConcurrencySafe: () => true,
    presentCall: () => teamPresent("team_list", "search"),
    dynamicSchema: () => {
      const presenceUser = runtime.settingsNamespaces.view("ui-presence")
        .value as Record<string, unknown>;
      const localeUser = runtime.settingsNamespaces.view("locale")
        .value as Record<string, unknown>;
      return {
        description: teamListDescription({
          listOnly,
          ...(selfMemberId ? { selfRevise: true } : {}),
          titles: readSeatTitles(
            presenceUser,
            readUiLocalePreference(localeUser),
          ),
        }),
      };
    },
    execute: async () => {
      const workspaceId = ws();
      const members = runtime.agentRoster
        .listVisible(workspaceId)
        .map((row) => enrichListedMember(runtime, workspaceId, row));
      return { content: JSON.stringify({ workspaceId, members }) };
    },
  });

  if (listOnly) {
    if (selfMemberId) {
      registerTool(tools, {
        name: "team_self",
        description:
          "Revise YOUR surfaces (playbook / brief / inject / tools). " +
          "Durable for next spawn + export; also rewrites 干员家 AGENTS.md " +
          "(+ pack playbook.md when advanced). Same fan-out if you edit AGENTS.md. " +
          "No mint / import / export / edit others.",
        parameters: {
          type: "object",
          properties: {
            playbook: {
              type: "string",
              description: "Replacement playbook (max 20000). Omit to keep.",
            },
            brief: {
              type: "string",
              description: "Replacement duty line. Omit to keep.",
            },
            name: {
              type: "string",
              description: "Optional display-name tweak. Omit to keep.",
            },
            inject: {
              type: "string",
              description: "minimal (thin context) | subagent (keep project docs). Omit to keep.",
            },
            tools: {
              type: "object",
              properties: {
                mode: { type: "string" },
                names: { type: "array", items: { type: "string" } },
              },
              additionalProperties: false,
              description: "allow|deny list on top of role. Pass null to clear.",
            },
          },
          additionalProperties: false,
        },
        presentCall: (args) => teamPresent("team_self", "execute", args),
        execute: async (args) => {
          const a = readArgs(args);
          const canvasId = ws();
          const existing = runtime.agentRoster.get(canvasId, selfMemberId);
          if (!existing || existing.catalog) {
            return {
              content: `team_self: member "${selfMemberId}" not editable here`,
              isError: true,
            };
          }
          const hasPlaybook = typeof a.playbook === "string";
          const hasBrief = typeof a.brief === "string";
          const hasName = typeof a.name === "string" && a.name.trim().length > 0;
          const hasInject = a.inject === "minimal" || a.inject === "subagent";
          const hasTools = a.tools !== undefined;
          if (!hasPlaybook && !hasBrief && !hasName && !hasInject && !hasTools) {
            return {
              content:
                "team_self: pass playbook, brief, inject, and/or tools (optional name)",
              isError: true,
            };
          }
          const toolsPatch =
            a.tools === null
              ? null
              : hasTools
                ? parseMemberToolPolicy(a.tools)
                : undefined;
          if (hasTools && a.tools !== null && !toolsPatch) {
            return {
              content: 'team_self: tools needs { mode: "allow"|"deny", names: [...] }',
              isError: true,
            };
          }
          const patched = patchExistingMember(runtime, canvasId, existing, {
            ...(hasName ? { name: String(a.name).trim() } : {}),
            ...(hasPlaybook ? { playbook: String(a.playbook) } : {}),
            ...(hasBrief ? { brief: String(a.brief) } : {}),
            ...(hasInject
              ? { inject: parseMemberInject(a.inject, existing.inject) }
              : {}),
            ...(hasTools ? { tools: toolsPatch ?? null } : {}),
          });
          if (!patched) {
            return { content: "team_self: name and playbook required", isError: true };
          }
          // Heal disk mirrors first, then public fields — never echo a stale
          // roster playbook when the caller omitted the playbook field.
          const playbook = liveMemberPlaybook(runtime, canvasId, patched);
          return {
            content: JSON.stringify({
              member: {
                ...enrichListedMember(runtime, canvasId, patched),
                playbook,
              },
              next: "next subagent member_id uses these surfaces; this turn already started",
            }),
          };
        },
      });
    }
    return;
  }

  registerTool(tools, {
    name: "team_save",
    description:
      "Mint or revise a 干员 (skill xrk-delegate). Does not create 干员家. " +
      "Thin: name+playbook (+inject/tools). " +
      `Advanced: kind=advanced + skills/files/env_prep → team_ready → team_home. ` +
      "Revise: id= (omit unchanged). Install shared: team_import. Open home: team_home.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "Existing mem_… to revise (thin or advanced). Omit to mint. Pattern: mem_[A-Za-z0-9][A-Za-z0-9._-]*",
        },
        name: {
          type: "string",
          description: "Short label (e.g. PPT排版员). On revise, omit to keep.",
        },
        playbook: {
          type: "string",
          description:
            `Durable how-to. Prefer: Role; Steps; Constraints; Acceptance; for advanced also list what is in ${MEMBER_PACK_BRIEFCASE}. ` +
            "On revise, omit to keep. Max 20000. Template: skill xrk-delegate.",
        },
        role: { type: "string" },
        kind: {
          type: "string",
          description:
            "thin (default) | advanced. Also advanced when skills/files/env_prep set.",
        },
        brief: { type: "string", description: "One-line duty for team_list." },
        scope: {
          type: "string",
          description:
            "global | workspace. Thin default workspace; advanced default global.",
        },
        inject: {
          type: "string",
          description: "minimal (default) | subagent (keep project docs)",
        },
        tools: {
          type: "object",
          properties: {
            mode: { type: "string" },
            names: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
          description: "Child tool allow|deny on top of role.",
        },
        env_prep: {
          type: "string",
          description:
            `Advanced ${MEMBER_PACK_BRIEFCASE}: env/SETUP.md (links, installs). Never auto-run. Merge on id= revise.`,
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description:
            `Advanced: skill dirs → ${MEMBER_PACK_BRIEFCASE} skills/<id>/ (full tree incl. references/). Merge on id=.`,
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            `Advanced: paths → ${MEMBER_PACK_BRIEFCASE} workspace/ (materials; not session cwd). Merge on id=.`,
        },
      },
      additionalProperties: false,
    },
    presentCall: (args) => teamPresent("team_save", "execute", args),
    execute: async (args) => {
      const a = readArgs(args);
      const idProblem = memberIdProblem(a.id);
      if (idProblem) return { content: `team_save: ${idProblem}`, isError: true };
      const catalogProblem = catalogMemberWriteProblem(a.id);
      if (catalogProblem) return { content: `team_save: ${catalogProblem}`, isError: true };
      const name = String(a.name ?? "").trim();
      const playbook = String(a.playbook ?? "").trim();
      const roleRaw = typeof a.role === "string" ? a.role : "worker";
      const canvasId = ws();
      const wantsAdvanced =
        a.kind === "advanced" ||
        (typeof a.env_prep === "string" && a.env_prep.trim().length > 0) ||
        (Array.isArray(a.skills) && a.skills.length > 0) ||
        (Array.isArray(a.files) && a.files.length > 0);
      const scope = parseRosterScope(
        a.scope ?? (wantsAdvanced ? "global" : "workspace"),
      );
      if (scope === undefined) {
        return {
          content: 'team_save: scope must be "workspace" or "global"',
          isError: true,
        };
      }
      if (typeof a.id === "string" && a.id.trim()) {
        const existing = runtime.agentRoster.get(canvasId, a.id.trim());
        if (!existing) {
          return {
            content: missingMemberHint(runtime, canvasId, a.id.trim(), "team_save"),
            isError: true,
          };
        }
        const toolsPatch =
          a.tools === null
            ? null
            : a.tools !== undefined
              ? parseMemberToolPolicy(a.tools)
              : undefined;
        if (a.tools !== undefined && a.tools !== null && !toolsPatch) {
          return {
            content: 'team_save: tools needs { mode: "allow"|"deny", names: [...] }',
            isError: true,
          };
        }
        const hasName = name.length > 0;
        const hasPlaybook = playbook.length > 0;
        const hasSurface =
          hasName ||
          hasPlaybook ||
          typeof a.brief === "string" ||
          a.inject === "minimal" ||
          a.inject === "subagent" ||
          a.tools !== undefined;

        if (existing.kind === "advanced") {
          const rosterWs =
            existing.scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
          const packOpts = {
            rosterWorkspaceId: rosterWs,
            memberId: existing.id,
            productHome: runtime.agentRoster.home,
          };
          let inventory = listMemberPackInventory(packOpts);
          const skillPaths = resolveCwdPaths(runtime, sessionId, a.skills);
          const filePaths = resolveCwdPaths(runtime, sessionId, a.files);
          const envPrep =
            typeof a.env_prep === "string" && a.env_prep.trim()
              ? a.env_prep.trim()
              : undefined;
          if (skillPaths.length > 0 || filePaths.length > 0 || envPrep) {
            let skillsFiles: ReadonlyMap<string, Buffer> | undefined;
            if (skillPaths.length > 0) {
              const bundled = collectPackSkillFiles(skillPaths);
              if (!bundled.ok) {
                return { content: `team_save: ${bundled.error}`, isError: true };
              }
              skillsFiles = bundled.files;
            }
            let workspaceFiles: ReadonlyMap<string, Buffer> | undefined;
            if (filePaths.length > 0) {
              const bundled = collectPackWorkspaceFiles(filePaths);
              if (!bundled.ok) {
                return { content: `team_save: ${bundled.error}`, isError: true };
              }
              workspaceFiles = bundled.files;
            }
            const merged = mergeIntoMemberPack({
              ...packOpts,
              ...(skillsFiles ? { skillsFiles } : {}),
              ...(workspaceFiles ? { workspaceFiles } : {}),
              ...(envPrep ? { envPrep } : {}),
            });
            if (!merged.ok) {
              return { content: `team_save: ${merged.error}`, isError: true };
            }
            inventory = merged.inventory;
          }
          let patched = existing;
          if (hasSurface) {
            const next = patchExistingMember(runtime, canvasId, existing, {
              ...(hasName ? { name } : {}),
              ...(hasPlaybook ? { playbook } : {}),
              ...(typeof a.brief === "string" ? { brief: a.brief } : {}),
              ...(a.inject === "minimal" || a.inject === "subagent"
                ? { inject: a.inject }
                : {}),
              ...(a.tools !== undefined ? { tools: toolsPatch ?? null } : {}),
            });
            if (!next) {
              return {
                content: "team_save: name and playbook required",
                isError: true,
              };
            }
            patched = next;
          } else if (
            skillPaths.length === 0 &&
            filePaths.length === 0 &&
            !envPrep
          ) {
            return {
              content:
                "team_save: pass playbook/brief/inject/tools and/or skills/files/env_prep to revise",
              isError: true,
            };
          }
          // Heal disk first (omit-playbook must not echo a stale roster copy).
          const livePlaybook = liveMemberPlaybook(runtime, canvasId, patched);
          return {
            content: JSON.stringify({
              workspaceId: patched.scope === "global" ? "global" : canvasId,
              member: {
                ...enrichListedMember(runtime, canvasId, patched),
                playbook: livePlaybook,
              },
              kind: "advanced",
              briefcase: MEMBER_PACK_BRIEFCASE,
              ...(inventory ? { inventory } : {}),
              next: patched.ready
                ? "subagent member_id · team_export to share"
                : "follow envPrep → team_ready → team_home | subagent member_id",
            }),
          };
        }

        // Thin revise (or upgrade path falls through to mint when wantsAdvanced).
        if (!wantsAdvanced) {
          if (!hasSurface) {
            return {
              content: "team_save: pass playbook/brief/inject/tools to revise thin",
              isError: true,
            };
          }
          const patched = patchExistingMember(runtime, canvasId, existing, {
            ...(hasName ? { name } : {}),
            ...(hasPlaybook ? { playbook } : {}),
            ...(typeof a.brief === "string" ? { brief: a.brief } : {}),
            ...(a.inject === "minimal" || a.inject === "subagent"
              ? { inject: a.inject }
              : {}),
            ...(a.tools !== undefined ? { tools: toolsPatch ?? null } : {}),
          });
          if (!patched) {
            return {
              content: "team_save: name and playbook required",
              isError: true,
            };
          }
          return {
            content: JSON.stringify({
              workspaceId: patched.scope === "global" ? "global" : canvasId,
              member: enrichListedMember(runtime, canvasId, patched),
              kind: "thin",
              next: "subagent member_id",
            }),
          };
        }
      }
      if (wantsAdvanced) {
        const minted = mintAdvancedMember({
          runtime,
          sessionId,
          canvasId,
          scope,
          name,
          playbook,
          roleRaw,
          ...(typeof a.brief === "string" ? { brief: a.brief } : {}),
          inject: a.inject,
          tools: a.tools,
          ...(typeof a.env_prep === "string" ? { envPrep: a.env_prep } : {}),
          skills: a.skills,
          files: a.files,
          ...(typeof a.id === "string" ? { id: a.id } : {}),
        });
        return {
          content: minted.content,
          ...(minted.ok ? {} : { isError: true }),
        };
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
    description:
      `Install shared 干员: card= (thin JSON) or pack= (advanced zip/dir → ${MEMBER_PACK_BRIEFCASE}). ` +
      "Installs member only — no 干员家. Then envPrep → team_ready → team_home to open home. " +
      "Revise: team_save id=. Mint new: team_save.",
    parameters: {
      type: "object",
      properties: {
        card: {
          type: "string",
          description: "Thin JSON (kind xrk-agent-member). Omit when pack.",
        },
        pack: {
          type: "string",
          description:
            "Marked pack zip/dir path (cwd-relative OK) or upload id " +
            "(attachment:sha256:… / sha256:…). Omit when card.",
        },
        scope: {
          type: "string",
          description:
            "global | workspace. Defaults: card→workspace; pack→global (shareable).",
        },
      },
      additionalProperties: false,
    },
    presentCall: (args) => teamPresent("team_import", "execute", args),
    execute: async (args) => {
      const a = readArgs(args);
      if (a.from_session === true) {
        return {
          content:
            "team_import: minting moved to team_save (kind=advanced + name/playbook/skills/files). " +
            "team_import is only card= or pack= install.",
          isError: true,
        };
      }
      const hasCard = typeof a.card === "string" && a.card.trim().length > 0;
      const hasPack = typeof a.pack === "string" && a.pack.trim().length > 0;
      if (hasCard === hasPack) {
        return {
          content:
            "team_import: set exactly one of card (JSON) or pack (path|attachment). " +
            "Mint new → team_save.",
          isError: true,
        };
      }
      const scope = parseRosterScope(
        a.scope ?? (hasCard ? "workspace" : "global"),
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

      const packLabel = String(a.pack);
      const loaded = await loadPackFromArg(runtime, sessionId, packLabel);
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
          pack: packLabel,
          packDir: placed.packDir,
          skillNames: placed.skillNames,
          ready: false,
          ...(placed.envPrep ? { envPrep: placed.envPrep } : {}),
          next: "team_ready → team_home | subagent member_id",
          layout: AGENT_MEMBER_PACK_LAYOUT,
        }),
      };
    },
  });

  registerTool(tools, {
    name: "team_ready",
    description:
      "Mark advanced 干员 ready after env prep (id=). Does not create 干员家. " +
      "Required before subagent member_id on advanced. Thin stays ready.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "mem_… from team_list (not-ready advanced)" },
        ready: {
          type: "boolean",
          description: "Default true. Pass false to mark not-ready again.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    presentCall: (args) => teamPresent("team_ready", "execute", args),
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
          next: updated.ready
            ? "team_home | subagent member_id"
            : "configure then team_ready again",
        }),
      };
    },
  });

  registerTool(tools, {
    name: "team_home",
    description:
      "Create 干员家 for an existing member (id=). Returns homeWorkspaceId. " +
      "Idempotent. Members have no home until this (or UI 添加干员工作区). " +
      "Not team_ready / team_save / team_import.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "mem_… from team_list" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    presentCall: (args) => teamPresent("team_home", "execute", args),
    execute: async (args) => {
      const a = readArgs(args);
      const id = String(a.id ?? "").trim();
      if (!id) return { content: "team_home: id required", isError: true };
      if (id === MANAGER_MEMBER_ID || id === SUNFLOWER_MEMBER_ID) {
        return {
          content: `team_home: ${id} is an office seat — no agent-home`,
          isError: true,
        };
      }
      const canvasId = ws();
      const member = runtime.agentRoster.get(canvasId, id);
      if (!member) {
        return { content: missingMemberHint(runtime, canvasId, id, "team_home"), isError: true };
      }
      const home = await mintAgentHomeForMember(runtime, member, canvasId);
      return {
        content: JSON.stringify({
          memberId: member.id,
          name: member.name,
          homeWorkspaceId: home.workspaceId,
          created: home.created,
          next: "workspace_session_prompt(homeWorkspaceId) | subagent member_id",
        }),
      };
    },
  });

  registerTool(tools, {
    name: "team_export",
    description:
      `Export custom 干员: thin→JSON, advanced→zip (${MEMBER_PACK_BRIEFCASE}). ` +
      "dir= defaults to session cwd. Catalog mem_seed_* cannot export.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "mem_… from team_list (not catalog)" },
        dir: {
          type: "string",
          description:
            "Output directory (cwd-relative or absolute). Default: session cwd.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    presentCall: (args) => teamPresent("team_export", "execute", args),
    execute: async (args) => {
      const a = readArgs(args);
      const id = String(a.id ?? "").trim();
      if (!id) return { content: "team_export: id required", isError: true };
      const exported = await dispatchFaceMethod(runtime, "team.export", `te-${Date.now()}`, {
        sessionId,
        id,
      });
      if (!exported.result.ok) {
        const msg =
          typeof exported.result.error === "object" &&
          exported.result.error &&
          "message" in exported.result.error
            ? String((exported.result.error as { message?: string }).message)
            : "export failed";
        return { content: `team_export: ${msg}`, isError: true };
      }
      const value = exported.result.value as {
        format: string;
        fileName: string;
        text?: string;
        base64?: string;
        packIncomplete?: boolean;
        hint?: string;
      };
      const cwd = resolveSessionCwd(runtime, sessionId);
      const dirRaw = typeof a.dir === "string" ? a.dir.trim() : "";
      const outDir = dirRaw
        ? path.isAbsolute(dirRaw)
          ? dirRaw
          : path.resolve(cwd, dirRaw)
        : cwd;
      const outPath = path.join(outDir, value.fileName);
      try {
        if (value.format === "json" && typeof value.text === "string") {
          writeFileSync(outPath, value.text, "utf8");
        } else if (value.format === "zip" && typeof value.base64 === "string") {
          writeFileSync(outPath, Buffer.from(value.base64, "base64"));
        } else {
          return { content: "team_export: empty payload", isError: true };
        }
      } catch (err) {
        return {
          content: `team_export: write failed — ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
      return {
        content: JSON.stringify({
          format: value.format,
          path: outPath,
          fileName: value.fileName,
          ...(value.packIncomplete
            ? { packIncomplete: true, hint: value.hint }
            : {}),
          next:
            value.format === "zip"
              ? "Hand zip → team_import pack= → follow envPrep → team_ready"
              : "Hand JSON → team_import card= or UI import",
        }),
      };
    },
  });

  registerTool(tools, {
    name: "team_remove",
    description:
      "Uninstall a custom 干员 (not catalog mem_seed_*). Like deleting a skill. " +
      "Pass id from team_list; scope global|workspace must match where it lives.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "mem_… to delete" },
        scope: {
          type: "string",
          description: "global | workspace — must match team_list scope for that id",
        },
      },
      required: ["id", "scope"],
      additionalProperties: false,
    },
    presentCall: (args) => teamPresent("team_remove", "execute", args),
    execute: async (args) => {
      const a = readArgs(args);
      const id = String(a.id ?? "").trim();
      if (!id) return { content: "team_remove: id required", isError: true };
      const catalogProblem = catalogMemberWriteProblem(id);
      if (catalogProblem) {
        return { content: `team_remove: ${catalogProblem}`, isError: true };
      }
      const scope = parseRosterScope(a.scope);
      if (scope === undefined) {
        return {
          content: 'team_remove: scope must be "workspace" or "global"',
          isError: true,
        };
      }
      const canvasId = ws();
      const rosterWs = scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
      const ok = runtime.agentRoster.remove(rosterWs, id);
      if (!ok) {
        return {
          content: missingMemberHint(runtime, canvasId, id, "team_remove"),
          isError: true,
        };
      }
      return {
        content: JSON.stringify({
          workspaceId: rosterWs,
          deleted: true,
          id,
          next: "gone from team_list; zip/JSON copies elsewhere are untouched",
        }),
      };
    },
  });
}
