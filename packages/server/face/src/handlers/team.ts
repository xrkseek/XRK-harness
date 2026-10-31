/**
 * Face remotes `threads/*` and `team/*`: workspace 主线, plus Agent Team as the
 * child's tools / inject / playbook roster.
 */
import { existsSync } from "node:fs";
import { readSessionEvents } from "@xrkseek/core-session";
import {
  effectiveApprovalPolicy,
  effectiveSandboxMode,
  pathAccessModeFromSandbox,
} from "@xrkseek/protocol";
import { sessionNotFoundMessage } from "../face-error-text.js";
import { canvasWorkspaceIdForSession } from "../canvas-tools.js";
import {
  applySubagentSpawnPreamble,
  isAgentTeamSpawnRole,
  rootUserAuthorizationBlock,
} from "../agent-team-roles.js";
import {
  formatAgentMemberCard,
} from "../agent-member-card.js";
import {
  buildAgentMemberPackZip,
  loadAgentMemberPackBytes,
  materializeAgentMemberPack,
  notReadyPackHints,
  formatMemberPackInventoryLines,
  listMemberPackInventory,
  resolveMemberPackHome,
  resolveMemberPackMaterialsDir,
  zipMemberPackDir,
} from "../agent-member-pack.js";
import {
  GLOBAL_ROSTER_ID,
  memberIdProblem,
  memberPackDir,
  catalogMemberExportProblem,
  catalogMemberWriteProblem,
  isCatalogSeedMemberId,
  MANAGER_MEMBER_ID,
  SUNFLOWER_MEMBER_ID,
  parseMemberAppearance,
  parseMemberNickname,
  parseMemberToolPolicy,
  parseRosterScope,
  type ListedRosterMember,
} from "../agent-roster-store.js";
import {
  catalogSeedFormalName,
  sunflowerLockedNickname,
} from "../catalog-seed-labels.js";
import { liveMemberPlaybook } from "../agent-roster-tools.js";
import { captureSessionPlaybook } from "../capture-member-playbook.js";
import { resolveSessionCwd } from "../session-cwd.js";
import {
  readSeatTitles,
  readUiLocalePreference,
} from "../seat-titles.js";
import { permissionSelectFromEvents } from "../permissions.js";
import { effectiveSessionAgentPreset } from "../session-agent-preset.js";
import { rosterScopeVisibility } from "../session-tool-copy.js";
import {
  publishSessionThread,
  publishSessionThreads,
  sessionIdsOnThread,
} from "../session-thread-publish.js";
import { asRecord, remoteArgs, type FaceHandler } from "./types.js";
import { sessionCreate, sessionPrompt } from "./session.js";
import {
  mintAgentHomeForMember,
  syncAgentHomePlaybook,
  agentHomeDir,
  unbindAgentHomeForMember,
} from "../agent-home.js";
import { publishWorkspaceChanged } from "../workspace-member-look.js";
import { resolveHarnessHome } from "../settings-document.js";

function sessionIdOf(payload: unknown): string {
  const args = remoteArgs(payload);
  const flat = asRecord(payload);
  return String(
    args.sessionId ?? flat.sessionId ?? args.agentId ?? flat.agentId ?? "",
  ).trim();
}

function requireSession(runtime: Parameters<FaceHandler>[0], sessionId: string) {
  if (!sessionId) {
    return {
      ok: false as const,
      error: { code: "invalid-payload" as const, message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false as const,
      error: { code: "session-not-found" as const, message: sessionNotFoundMessage(sessionId) },
    };
  }
  return undefined;
}

export const threadsList: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  return {
    ok: true,
    value: {
      workspaceId,
      threads: runtime.sessionThreads.list(workspaceId),
      bind: runtime.sessionThreads.bindOf(workspaceId, sessionId) ?? null,
    },
  };
};

export const threadsUpsert: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const title = String(args.title ?? "").trim();
  const brief = typeof args.brief === "string" ? args.brief : "";
  const id = typeof args.id === "string" ? args.id : undefined;
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const thread = runtime.sessionThreads.upsert(workspaceId, {
    title,
    brief,
    ...(id ? { id } : {}),
  });
  if (!thread) {
    return { ok: false, error: { code: "invalid-payload", message: "title required" } };
  }
  if (args.switch !== false) {
    runtime.sessionThreads.switchTo(workspaceId, sessionId, thread.id);
  }
  const affected = new Set(sessionIdsOnThread(runtime, workspaceId, thread.id));
  affected.add(sessionId);
  publishSessionThreads(runtime, workspaceId, [...affected]);
  return { ok: true, value: { workspaceId, thread } };
};

export const threadsSwitch: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const id = String(remoteArgs(payload).id ?? "").trim();
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const bind = runtime.sessionThreads.switchTo(workspaceId, sessionId, id);
  if (!bind) {
    return { ok: false, error: { code: "invalid-payload", message: "unknown thread id" } };
  }
  publishSessionThread(runtime, workspaceId, sessionId);
  return { ok: true, value: { workspaceId, bind } };
};

export const threadsRemove: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const id = String(remoteArgs(payload).id ?? "").trim();
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const affected = sessionIdsOnThread(runtime, workspaceId, id);
  const ok = runtime.sessionThreads.remove(workspaceId, id);
  if (!ok) {
    return { ok: false, error: { code: "invalid-payload", message: "unknown thread id" } };
  }
  publishSessionThreads(runtime, workspaceId, affected);
  return { ok: true, value: { workspaceId, deleted: true, id } };
};

function listMemberForClient(
  runtime: Parameters<FaceHandler>[0],
  canvasId: string,
  row: ListedRosterMember,
  locale: ReturnType<typeof readUiLocalePreference>,
  seatTitles: ReturnType<typeof readSeatTitles>,
) {
  // Advanced: surface disk playbook.md (and heal roster) so TeamRoster stays hot.
  const playbook = liveMemberPlaybook(runtime, canvasId, row);
  let live =
    playbook === row.playbook
      ? row
      : { ...row, playbook };
  // Catalog seeds: locale formal name (+ locked sunflower nick for chrome).
  const formal = catalogSeedFormalName(live.id, locale, seatTitles);
  if (formal) {
    live = {
      ...live,
      name: formal,
      ...(live.id === SUNFLOWER_MEMBER_ID
        ? { nickname: sunflowerLockedNickname(locale) }
        : {}),
    };
  }
  if (live.kind !== "advanced" || live.ready) return live;
  const rosterWs = live.scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
  return {
    ...live,
    ...notReadyPackHints({
      rosterWorkspaceId: rosterWs,
      memberId: live.id,
      productHome: runtime.agentRoster.home,
    }),
  };
}

export const teamList: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const locale = readUiLocalePreference(localeUser);
  const seatTitles = readSeatTitles(presenceUser, locale);
  return {
    ok: true,
    value: {
      workspaceId,
      members: runtime.agentRoster
        .listForTeamPanel(workspaceId)
        .map((row) =>
          listMemberForClient(
            runtime,
            row.scope === "workspace" && row.workspaceId
              ? row.workspaceId
              : workspaceId,
            row,
            locale,
            seatTitles,
          ),
        ),
    },
  };
};

export const teamUpsert: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const idProblem = memberIdProblem(args.id);
  if (idProblem) {
    return { ok: false, error: { code: "invalid-payload", message: idProblem } };
  }
  const roleRaw = typeof args.role === "string" ? args.role : "worker";
  const canvasId = canvasWorkspaceIdForSession(runtime, sessionId);
  const scope = parseRosterScope(args.scope);
  if (scope === undefined) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: 'scope must be "workspace" or "global"' },
    };
  }
  const appearanceArg =
    args.appearance && typeof args.appearance === "object"
      ? args.appearance
      : {
          ...(typeof args.shape === "string" ? { shape: args.shape } : {}),
          ...(typeof args.color === "string" ? { color: args.color } : {}),
          ...(typeof args.kit === "string" ? { kit: args.kit } : {}),
          ...(typeof args.face === "string" ? { face: args.face } : {}),
        };
  const hasAppearance =
    appearanceArg &&
    typeof appearanceArg === "object" &&
    Object.keys(appearanceArg).length > 0;
  const rawId = typeof args.id === "string" ? args.id.trim() : "";
  const nicknameArg =
    args.nickname === null
      ? null
      : typeof args.nickname === "string"
        ? args.nickname
        : undefined;
  if (rawId === SUNFLOWER_MEMBER_ID && nicknameArg !== undefined) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: `catalog member ${SUNFLOWER_MEMBER_ID} nickname is locked`,
      },
    };
  }
  // Catalog: patch costume (经理) / nickname (all but 向日葵). Never mint home.
  // Seed playbook stays frozen.
  if (rawId && isCatalogSeedMemberId(rawId)) {
    let listed = runtime.agentRoster
      .listVisible(canvasId)
      .find((row) => row.id === rawId);
    if (!listed) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: `catalog member ${rawId} not found`,
        },
      };
    }
    const wantAppearance =
      rawId === MANAGER_MEMBER_ID && hasAppearance;
    const wantNickname = nicknameArg !== undefined;
    if (wantAppearance || wantNickname) {
      const patched = runtime.agentRoster.patchCatalogMeta(rawId, {
        ...(wantAppearance
          ? {
              appearance: parseMemberAppearance(appearanceArg, {
                shape: listed.appearance.shape,
                color: listed.appearance.color,
              }),
            }
          : {}),
        ...(wantNickname ? { nickname: nicknameArg } : {}),
      });
      if (patched) {
        listed =
          runtime.agentRoster
            .listVisible(canvasId)
            .find((row) => row.id === rawId) ?? {
              ...patched,
              scope: "global" as const,
              catalog: true as const,
            };
      }
    }
    // Catalog costume / nick edits must not mint 干员工作区 — only explicit
    // 「添加干员工作区」(mintHome) or import/capture does.
    const existingHome = runtime.workspaces.findAgentHomeByMember(rawId);
    if (existingHome && wantAppearance) {
      publishWorkspaceChanged(runtime, existingHome);
    }
    const presenceUser = runtime.settingsNamespaces.view("ui-presence")
      .value as Record<string, unknown>;
    const localeUser = runtime.settingsNamespaces.view("locale")
      .value as Record<string, unknown>;
    const locale = readUiLocalePreference(localeUser);
    const seatTitles = readSeatTitles(presenceUser, locale);
    return {
      ok: true,
      value: {
        workspaceId: "global",
        member: listMemberForClient(
          runtime,
          canvasId,
          listed,
          locale,
          seatTitles,
        ),
        ...(existingHome ? { homeWorkspaceId: existingHome.workspaceId } : {}),
      },
    };
  }
  const catalogProblem = catalogMemberWriteProblem(args.id);
  if (catalogProblem) {
    return { ok: false, error: { code: "invalid-payload", message: catalogProblem } };
  }
  const toolsRaw =
    args.tools && typeof args.tools === "object" ? args.tools : undefined;
  const tools = parseMemberToolPolicy(toolsRaw);
  const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
    name: String(args.name ?? ""),
    playbook: String(args.playbook ?? ""),
    role: isAgentTeamSpawnRole(roleRaw) ? roleRaw : "worker",
    ...(typeof args.brief === "string" ? { brief: args.brief } : {}),
    ...(nicknameArg !== undefined
      ? { nickname: nicknameArg === null ? null : parseMemberNickname(nicknameArg) ?? null }
      : {}),
    ...(args.inject === "subagent" || args.inject === "minimal"
      ? { inject: args.inject }
      : {}),
    ...(tools
      ? { tools }
      : args.tools === null
        ? { tools: null }
        : {}),
    ...(hasAppearance
      ? {
          appearance: parseMemberAppearance(appearanceArg, {
            shape: "blob",
            color: "cream",
          }),
        }
      : {}),
    ...(typeof args.id === "string" ? { id: args.id } : {}),
    ...(args.kind === "advanced" || args.kind === "thin"
      ? { kind: args.kind }
      : {}),
    ...(typeof args.ready === "boolean" ? { ready: args.ready } : {}),
  });
  if (!member) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "name and playbook required" },
    };
  }
  // Mint only when UI explicitly asks (`mintHome` from 添加干员工作区).
  // Roster create / nick / look edits stay on the project lane — spawning a
  // tool child in a coding workspace must not invent a 干员工作区 row.
  const mintHome = args.mintHome === true;
  const existingHome = runtime.workspaces.findAgentHomeByMember(member.id);
  if (mintHome) {
    const home = await mintAgentHomeForMember(runtime, member, canvasId);
    return {
      ok: true,
      value: {
        workspaceId: scope === "global" ? "global" : canvasId,
        member,
        homeWorkspaceId: home.workspaceId,
      },
    };
  }
  const listed: ListedRosterMember = {
    ...member,
    scope,
    ...(isCatalogSeedMemberId(member.id) ? { catalog: true as const } : {}),
    ...(scope === "workspace" ? { workspaceId: canvasId } : {}),
  };
  if (existingHome) {
    const abs = agentHomeDir(
      member.id,
      runtime.agentRoster.home ?? resolveHarnessHome(runtime),
    );
    syncAgentHomePlaybook(abs, liveMemberPlaybook(runtime, canvasId, listed));
    if (hasAppearance) publishWorkspaceChanged(runtime, existingHome);
  }
  const presenceUser = runtime.settingsNamespaces.view("ui-presence")
    .value as Record<string, unknown>;
  const localeUser = runtime.settingsNamespaces.view("locale")
    .value as Record<string, unknown>;
  const locale = readUiLocalePreference(localeUser);
  const seatTitles = readSeatTitles(presenceUser, locale);
  return {
    ok: true,
    value: {
      workspaceId: scope === "global" ? "global" : canvasId,
      member: listMemberForClient(
        runtime,
        canvasId,
        listed,
        locale,
        seatTitles,
      ),
      ...(existingHome ? { homeWorkspaceId: existingHome.workspaceId } : {}),
    },
  };
};

export const teamRemove: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const id = String(args.id ?? "").trim();
  const catalogProblem = catalogMemberWriteProblem(id);
  if (catalogProblem) {
    return { ok: false, error: { code: "invalid-payload", message: catalogProblem } };
  }
  const canvasId = canvasWorkspaceIdForSession(runtime, sessionId);
  const scope = parseRosterScope(args.scope);
  if (scope === undefined) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: 'scope must be "workspace" or "global"' },
    };
  }
  const workspaceId = scope === "global" ? "global" : canvasId;
  const ok = runtime.agentRoster.remove(workspaceId, id);
  if (!ok) {
    return { ok: false, error: { code: "invalid-payload", message: "unknown member id" } };
  }
  await unbindAgentHomeForMember(runtime, id);
  return { ok: true, value: { workspaceId, deleted: true, id } };
};

export const teamCapture: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const captured = captureSessionPlaybook(runtime, sessionId);
  if (!captured) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "session has no user message to capture" },
    };
  }
  const args = remoteArgs(payload);
  const canvasId = canvasWorkspaceIdForSession(runtime, sessionId);
  const scope = parseRosterScope(args.scope);
  if (scope === undefined) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: 'scope must be "workspace" or "global"' },
    };
  }
  const name = String(args.name ?? "").trim() || captured.name;
  const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
    name,
    playbook: captured.playbook,
    role: "worker",
  });
  if (!member) {
    return { ok: false, error: { code: "invalid-payload", message: "could not save member" } };
  }
  const home = await mintAgentHomeForMember(runtime, member, canvasId);
  return {
    ok: true,
    value: {
      workspaceId: scope === "global" ? "global" : canvasId,
      member,
      homeWorkspaceId: home.workspaceId,
    },
  };
};

export const teamDispatch: FaceHandler = async (runtime, rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const memberId = String(args.memberId ?? args.id ?? "").trim();
  const task = String(args.task ?? "").trim();
  if (!task) {
    return { ok: false, error: { code: "invalid-payload", message: "task required" } };
  }
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const member = runtime.agentRoster.get(workspaceId, memberId);
  if (!member) {
    const home = runtime.agentRoster.findHome(memberId);
    if (home && home.scope === "workspace" && home.rosterWorkspaceId !== workspaceId) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message:
            `member ${memberId} is workspace-scoped on canvas ${home.rosterWorkspaceId} ` +
            `(not visible here). Open that workspace, or re-import with scope=global.`,
        },
      };
    }
    return { ok: false, error: { code: "invalid-payload", message: "unknown member id" } };
  }
  if (!member.ready) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: `member ${member.id} is not ready (team_ready after env prep)`,
      },
    };
  }
  const rosterWs = member.scope === "global" ? GLOBAL_ROSTER_ID : workspaceId;
  const packOpts =
    member.kind === "advanced"
      ? {
          rosterWorkspaceId: rosterWs,
          memberId: member.id,
          ...(runtime.agentRoster.home
            ? { productHome: runtime.agentRoster.home }
            : {}),
        }
      : undefined;
  const packHome = packOpts ? resolveMemberPackHome(packOpts) : undefined;
  const packMaterials = packOpts
    ? resolveMemberPackMaterialsDir(packOpts)
    : undefined;
  const packInventory = packOpts
    ? listMemberPackInventory(packOpts)
    : undefined;
  const packInventoryLines = packInventory
    ? formatMemberPackInventoryLines(packInventory)
    : undefined;
  const childCwd = resolveSessionCwd(runtime, sessionId);
  const created = await sessionCreate(runtime, `${rpcId}-c`, {
    parentSessionId: sessionId,
    label: member.name,
    role: member.role,
    memberId: member.id,
    mode: "continuable",
  });
  if (!created.ok) return created;
  const childId = String(
    (created.value as { sessionId?: string }).sessionId ?? "",
  );
  const parentEvents = readSessionEvents(runtime.store, sessionId);
  const auth = rootUserAuthorizationBlock({
    parentEvents,
  });
  const sandbox = effectiveSandboxMode(parentEvents);
  const permission = permissionSelectFromEvents(parentEvents).currentValue;
  const approval = effectiveApprovalPolicy(parentEvents);
  const prompt = applySubagentSpawnPreamble({
    prompt: `${liveMemberPlaybook(runtime, workspaceId, member).trim()}\n\nTASK:\n${task}`,
    parentSessionId: sessionId,
    childSessionId: childId,
    mode: "continuable",
    label: member.name,
    role: member.role,
    inheritContext: false,
    cwd: childCwd,
    isolatedWorktree: false,
    ...(packHome ? { packHome } : {}),
    ...(packMaterials ? { packMaterials } : {}),
    ...(packInventoryLines ? { packInventoryLines } : {}),
    memberId: member.id,
    inject: member.inject,
    permissionInherit: `${permission} (path=${pathAccessModeFromSandbox(sandbox)}) · approval=${approval}`,
    parentToolSurface: effectiveSessionAgentPreset(runtime, sessionId),
    ...(auth ? { userAuthorization: auth } : {}),
  });
  const prompted = await sessionPrompt(runtime, `${rpcId}-p`, {
    sessionId: childId,
    mode: "queue",
    content: [{ type: "text", text: prompt }],
  });
  if (!prompted.ok) return prompted;
  return {
    ok: true,
    value: { workspaceId, memberId: member.id, childSessionId: childId },
  };
};

function safeStem(name: string): string {
  const stem = name
    .trim()
    /* eslint-disable-next-line no-control-regex -- strip C0 controls from filenames */
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return stem || "member";
}

/** Thin → JSON card; advanced → zip of pack dir (or synthesized pack). */
export const teamExport: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  const id = String(args.id ?? args.memberId ?? "").trim();
  if (!id) {
    return { ok: false, error: { code: "invalid-payload", message: "id required" } };
  }
  const canvasId = canvasWorkspaceIdForSession(runtime, sessionId);
  const member = runtime.agentRoster.get(canvasId, id);
  if (!member) {
    return { ok: false, error: { code: "invalid-payload", message: "unknown member id" } };
  }
  const catalogProblem = catalogMemberExportProblem(member.id);
  if (catalogProblem || member.catalog) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: catalogProblem ?? `catalog member ${member.id} cannot be exported`,
      },
    };
  }
  const stem = safeStem(member.name);
  const playbook = liveMemberPlaybook(runtime, canvasId, member);
  if (member.kind !== "advanced") {
    const card = formatAgentMemberCard({
      name: member.name,
      playbook,
      role: isAgentTeamSpawnRole(member.role) ? member.role : "worker",
      ...(member.brief ? { brief: member.brief } : {}),
      ...(member.inject === "subagent" || member.inject === "minimal"
        ? { inject: member.inject }
        : {}),
      ...(member.tools ? { tools: member.tools } : {}),
    });
    return {
      ok: true,
      value: {
        format: "json" as const,
        fileName: `xrk-member-${stem}.json`,
        text: card,
      },
    };
  }
  const rosterWs = member.scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
  const packDir = memberPackDir(rosterWs, member.id, runtime.agentRoster.home);
  const fromDisk = existsSync(packDir) ? zipMemberPackDir(packDir) : undefined;
  const zipped =
    fromDisk ??
    buildAgentMemberPackZip({
      name: member.name,
      playbook,
      role: isAgentTeamSpawnRole(member.role) ? member.role : "worker",
      ...(member.brief ? { brief: member.brief } : {}),
      ...(member.inject === "subagent" || member.inject === "minimal"
        ? { inject: member.inject }
        : {}),
      ...(member.tools ? { tools: member.tools } : {}),
    });
  return {
    ok: true,
    value: {
      format: "zip" as const,
      fileName: `xrk-member-${stem}.zip`,
      base64: zipped.toString("base64"),
      ...(fromDisk
        ? {}
        : {
            packIncomplete: true as const,
            hint: "pack dir missing on disk — zip is playbook-only (no skills/env)",
          }),
    },
  };
};

/** UI zip upload → advanced member (ready=false) + materialize under packs/. */
export const teamImportPack: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const missing = requireSession(runtime, sessionId);
  if (missing) return missing;
  const args = remoteArgs(payload);
  // Default global; UI/tools may pass workspace for canvas-only packs.
  const scope = parseRosterScope(args.scope ?? "global");
  if (scope === undefined) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: 'scope must be "workspace" or "global"' },
    };
  }
  const b64 = String(args.zipBase64 ?? args.base64 ?? "").trim();
  if (!b64) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "zipBase64 required" },
    };
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, error: { code: "invalid-payload", message: "zipBase64 invalid" } };
  }
  if (buf.length < 4) {
    return { ok: false, error: { code: "invalid-payload", message: "zip too small" } };
  }
  const loaded = loadAgentMemberPackBytes(buf);
  if (!loaded.ok) {
    return { ok: false, error: { code: "invalid-payload", message: loaded.error } };
  }
  const canvasId = canvasWorkspaceIdForSession(runtime, sessionId);
  const rosterWs = scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
  const member = runtime.agentRoster.upsertAtScope(canvasId, scope, {
    ...loaded.pack.card,
    kind: "advanced",
    ready: false,
  });
  if (!member) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "name and playbook required" },
    };
  }
  const placed = materializeAgentMemberPack(loaded.pack, {
    rosterWorkspaceId: rosterWs,
    memberId: member.id,
    productHome: runtime.agentRoster.home,
  });
  const home = await mintAgentHomeForMember(runtime, member, canvasId);
  return {
    ok: true,
    value: {
      workspaceId: rosterWs,
      scope,
      visibility: rosterScopeVisibility(scope, rosterWs),
      member,
      packDir: placed.packDir,
      skillNames: placed.skillNames,
      ...(placed.envPrep ? { envPrep: placed.envPrep } : {}),
      ready: false,
      homeWorkspaceId: home.workspaceId,
    },
  };
};
