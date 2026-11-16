/**
 * Single writer for 干员 identity playbook mirrors:
 * roster JSON · agent-home `AGENTS.md` · advanced pack `playbook.md`.
 *
 * Edit any mirror → fan-out to the others (content-equality skips no-ops and
 * prevents write↔adopt loops). Catalog seeds stay roster-locked.
 */

import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import type { FaceRuntime } from "./context.js";
import {
  GLOBAL_ROSTER_ID,
  MEMBER_PLAYBOOK_MAX,
  isCatalogSeedMemberId,
  memberPackDir,
  type ListedRosterMember,
} from "./agent-roster-store.js";
import {
  listMemberPackInventory,
  readMemberPackPlaybook,
  syncMemberPackPlaybook,
} from "./agent-member-pack.js";
import { isAgentTeamSpawnRole } from "./agent-team-roles.js";
import { resolveHarnessHome } from "./settings-document.js";

/** Local path helper — avoid importing agent-home (cycle with roster tools). */
function agentHomeDir(memberId: string, productHome: string): string {
  return path.join(path.resolve(productHome), "agent-homes", memberId.trim());
}

export type IdentityPlaybookSource =
  | "roster"
  | "agents-md"
  | "pack"
  | "adopt";

export function normalizeIdentityPlaybook(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export function agentHomeAgentsMdPath(absHome: string): string {
  return path.join(absHome, "AGENTS.md");
}

/** Read home `AGENTS.md` when present and non-empty. */
export function readAgentHomeAgentsMd(absHome: string): string | undefined {
  const file = agentHomeAgentsMdPath(absHome);
  try {
    if (!existsSync(file)) return undefined;
    const raw = readFileSync(file, "utf8");
    const trimmed = normalizeIdentityPlaybook(raw);
    if (!trimmed) return undefined;
    return trimmed.length > MEMBER_PLAYBOOK_MAX
      ? trimmed.slice(0, MEMBER_PLAYBOOK_MAX)
      : trimmed;
  } catch {
    return undefined;
  }
}

function productHomeOf(runtime: FaceRuntime): string {
  return runtime.agentRoster.home ?? resolveHarnessHome(runtime);
}

/**
 * If `absPath` is `{XRK_HOME}/agent-homes/<memberId>/AGENTS.md`, return memberId.
 */
export function memberIdFromAgentHomeAgentsMdPath(
  absPath: string,
  productHome: string,
): string | undefined {
  const resolved = path.resolve(absPath);
  if (path.basename(resolved).toLowerCase() !== "agents.md") return undefined;
  const homesRoot = path.resolve(productHome, "agent-homes");
  const parent = path.dirname(resolved);
  const root = path.dirname(parent);
  if (path.resolve(root) !== homesRoot) return undefined;
  const memberId = path.basename(parent).trim();
  return memberId || undefined;
}

function mtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function writeAgentsMdIfChanged(absHome: string, playbook: string): boolean {
  const file = agentHomeAgentsMdPath(absHome);
  const next = `${playbook}\n`;
  try {
    if (existsSync(file)) {
      const prev = normalizeIdentityPlaybook(readFileSync(file, "utf8"));
      if (prev === playbook) return false;
    }
    mkdirSync(absHome, { recursive: true });
    writeFileSync(file, next, "utf8");
    return true;
  } catch {
    return false;
  }
}

function listedOf(
  runtime: FaceRuntime,
  memberId: string,
): ListedRosterMember | undefined {
  const home = runtime.agentRoster.findHome(memberId);
  if (!home) return undefined;
  const canvas =
    home.scope === "global" ? GLOBAL_ROSTER_ID : home.rosterWorkspaceId;
  const row = runtime.agentRoster.get(canvas, memberId);
  if (!row) return undefined;
  return {
    ...row,
    scope: home.scope,
    ...(home.scope === "workspace"
      ? { workspaceId: home.rosterWorkspaceId }
      : {}),
  };
}

/**
 * Fan-out identity playbook to every live mirror.
 * Skips rewriting the originating mirror; equality checks stop loops.
 */
export function publishMemberIdentityPlaybook(
  runtime: FaceRuntime,
  input: {
    readonly memberId: string;
    readonly playbook: string;
    readonly source: IdentityPlaybookSource;
  },
):
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly playbook: string;
      readonly memberId: string;
    }
  | { readonly ok: false; readonly error: string } {
  const memberId = input.memberId.trim();
  const playbook = normalizeIdentityPlaybook(input.playbook);
  if (!memberId || !playbook) {
    return { ok: false, error: "memberId and playbook required" };
  }
  if (isCatalogSeedMemberId(memberId)) {
    return { ok: false, error: "catalog seed playbook is locked" };
  }
  const listed = listedOf(runtime, memberId);
  if (!listed) {
    return { ok: false, error: `unknown member ${memberId}` };
  }

  const clipped =
    playbook.length > MEMBER_PLAYBOOK_MAX
      ? playbook.slice(0, MEMBER_PLAYBOOK_MAX)
      : playbook;
  const rosterSame = normalizeIdentityPlaybook(listed.playbook) === clipped;
  let changed = false;

  if (!rosterSame) {
    const scope = listed.scope === "global" ? "global" : "workspace";
    const canvasId =
      listed.scope === "global" ? GLOBAL_ROSTER_ID : listed.workspaceId!;
    const upserted = runtime.agentRoster.upsertAtScope(canvasId, scope, {
      id: listed.id,
      name: listed.name,
      playbook: clipped,
      role: isAgentTeamSpawnRole(listed.role) ? listed.role : "worker",
      kind: listed.kind,
      ready: listed.ready,
      brief: listed.brief,
      inject: listed.inject,
      ...(listed.tools ? { tools: listed.tools } : {}),
      appearance: listed.appearance,
    });
    if (!upserted) {
      return { ok: false, error: "roster upsert failed" };
    }
    changed = true;
  }

  const homeAbs = agentHomeDir(memberId, productHomeOf(runtime));
  const homeBound = Boolean(runtime.workspaces.findAgentHomeByMember(memberId));
  if (homeBound || existsSync(homeAbs)) {
    if (input.source !== "agents-md") {
      if (writeAgentsMdIfChanged(homeAbs, clipped)) changed = true;
    }
  }

  if (listed.kind === "advanced" && input.source !== "pack") {
    const rosterWs =
      listed.scope === "global" ? GLOBAL_ROSTER_ID : listed.workspaceId!;
    const packOpts = {
      rosterWorkspaceId: rosterWs,
      memberId,
      productHome: runtime.agentRoster.home,
    };
    const disk = readMemberPackPlaybook(packOpts);
    if (normalizeIdentityPlaybook(disk ?? "") !== clipped) {
      // agents-md must not overwrite a newer pack playbook.md (same-second CI
      // clocks + omit-playbook team_save heal path).
      let skipPack = false;
      if (input.source === "agents-md") {
        const inventory = listMemberPackInventory(packOpts);
        const packPath =
          inventory?.playbookPath ??
          path.join(
            memberPackDir(rosterWs, memberId, runtime.agentRoster.home),
            "playbook.md",
          );
        const agentsPath = agentHomeAgentsMdPath(
          agentHomeDir(memberId, productHomeOf(runtime)),
        );
        if (mtimeMs(packPath) > mtimeMs(agentsPath)) skipPack = true;
      }
      if (
        !skipPack &&
        syncMemberPackPlaybook({
          ...packOpts,
          playbook: clipped,
        })
      ) {
        changed = true;
      }
    }
  }

  return { ok: true, changed, playbook: clipped, memberId };
}

type DiskCandidate = {
  readonly text: string;
  readonly mtime: number;
  readonly source: "agents-md" | "pack";
};

/**
 * Prefer freshest on-disk mirror (AGENTS.md / pack playbook.md), else roster.
 * Heals every lagging mirror when they diverge.
 */
export function adoptLiveMemberIdentityPlaybook(
  runtime: FaceRuntime,
  canvasId: string,
  row: ListedRosterMember,
): ListedRosterMember {
  if (isCatalogSeedMemberId(row.id) || row.catalog) {
    // Catalog playbook is locked — keep AGENTS.md as a one-way projection so
    // identity seats never diverge from spawn/export text.
    const homeAbs = agentHomeDir(row.id, productHomeOf(runtime));
    if (existsSync(homeAbs) || runtime.workspaces.findAgentHomeByMember(row.id)) {
      writeAgentsMdIfChanged(
        homeAbs,
        normalizeIdentityPlaybook(row.playbook),
      );
    }
    return row;
  }

  const rosterWs = row.scope === "global" ? GLOBAL_ROSTER_ID : canvasId;
  const candidates: DiskCandidate[] = [];

  const homeAbs = agentHomeDir(row.id, productHomeOf(runtime));
  const agentsPath = agentHomeAgentsMdPath(homeAbs);
  const agentsText = readAgentHomeAgentsMd(homeAbs);
  if (agentsText) {
    candidates.push({
      text: agentsText,
      mtime: mtimeMs(agentsPath),
      source: "agents-md",
    });
  }

  if (row.kind === "advanced") {
    const packText = readMemberPackPlaybook({
      rosterWorkspaceId: rosterWs,
      memberId: row.id,
      productHome: runtime.agentRoster.home,
    });
    if (packText) {
      const inventory = listMemberPackInventory({
        rosterWorkspaceId: rosterWs,
        memberId: row.id,
        productHome: runtime.agentRoster.home,
      });
      const packPath =
        inventory?.playbookPath ??
        path.join(
          memberPackDir(rosterWs, row.id, runtime.agentRoster.home),
          "playbook.md",
        );
      candidates.push({
        text: packText,
        mtime: mtimeMs(packPath),
        source: "pack",
      });
    }
  }

  if (candidates.length === 0) return row;

  candidates.sort(
    (a, b) => b.mtime - a.mtime || a.source.localeCompare(b.source),
  );
  const rosterText = normalizeIdentityPlaybook(row.playbook);
  const topMtime = candidates[0]!.mtime;
  const atTop = candidates.filter((c) => c.mtime === topMtime);
  // Same-second mtimes (esp. CI): prefer a disk mirror that already diverged
  // from roster so omit-playbook team_save / adopt cannot clobber a fresher
  // pack playbook.md with a lagging AGENTS.md (or the reverse).
  const diverged = atTop.filter((c) => c.text !== rosterText);
  const pool = diverged.length > 0 ? diverged : atTop;
  // Within the pool: prefer AGENTS.md (identity seat edits) when tied.
  const best =
    pool.find((c) => c.source === "agents-md") ?? pool[0]!;
  if (best.text === rosterText) {
    const published = publishMemberIdentityPlaybook(runtime, {
      memberId: row.id,
      playbook: best.text,
      source: best.source,
    });
    if (published.ok && published.changed) {
      return runtime.agentRoster.get(canvasId, row.id) ?? row;
    }
    return row;
  }

  const published = publishMemberIdentityPlaybook(runtime, {
    memberId: row.id,
    playbook: best.text,
    source: "adopt",
  });
  if (!published.ok) return row;
  return (
    runtime.agentRoster.get(canvasId, row.id) ?? {
      ...row,
      playbook: published.playbook,
    }
  );
}

/**
 * After a successful write tool: if the path is a 干员 home AGENTS.md,
 * fan-out into roster (+ pack).
 */
export function syncIdentityPlaybookAfterAgentsMdWrite(
  runtime: FaceRuntime,
  absPath: string,
): boolean {
  const memberId = memberIdFromAgentHomeAgentsMdPath(
    absPath,
    productHomeOf(runtime),
  );
  if (!memberId) return false;
  const homeAbs = agentHomeDir(memberId, productHomeOf(runtime));
  if (isCatalogSeedMemberId(memberId)) {
    // Restore locked catalog text — do not accept AGENTS.md as a new SoT.
    const listed = listedOf(runtime, memberId);
    if (!listed) return false;
    return writeAgentsMdIfChanged(
      homeAbs,
      normalizeIdentityPlaybook(listed.playbook),
    );
  }
  const text = readAgentHomeAgentsMd(homeAbs);
  if (!text) return false;
  const out = publishMemberIdentityPlaybook(runtime, {
    memberId,
    playbook: text,
    source: "agents-md",
  });
  return out.ok && out.changed;
}

/**
 * `{XRK_HOME}/agent-rosters/packs/<scope>/<memberId>/playbook.md` → memberId.
 */
export function memberIdFromPackPlaybookPath(
  absPath: string,
  productHome: string,
): string | undefined {
  const resolved = path.resolve(absPath);
  if (path.basename(resolved).toLowerCase() !== "playbook.md") return undefined;
  const packsRoot = path.resolve(productHome, "agent-rosters", "packs");
  const memberDir = path.dirname(resolved);
  const scopeDir = path.dirname(memberDir);
  const root = path.dirname(scopeDir);
  if (path.resolve(root) !== packsRoot) return undefined;
  const memberId = path.basename(memberDir).trim();
  return memberId || undefined;
}

/** Fan-out after an advanced pack `playbook.md` write. */
export function syncIdentityPlaybookAfterPackWrite(
  runtime: FaceRuntime,
  absPath: string,
): boolean {
  const memberId = memberIdFromPackPlaybookPath(
    absPath,
    productHomeOf(runtime),
  );
  if (!memberId || isCatalogSeedMemberId(memberId)) return false;
  const listed = listedOf(runtime, memberId);
  if (!listed || listed.kind !== "advanced") return false;
  const rosterWs =
    listed.scope === "global" ? GLOBAL_ROSTER_ID : listed.workspaceId!;
  const text = readMemberPackPlaybook({
    rosterWorkspaceId: rosterWs,
    memberId,
    productHome: runtime.agentRoster.home,
  });
  if (!text) return false;
  const out = publishMemberIdentityPlaybook(runtime, {
    memberId,
    playbook: text,
    source: "pack",
  });
  return out.ok && out.changed;
}

const WRITE_TOOL_NAMES = new Set([
  "write_file",
  "apply_edit",
  "apply_patch",
]);

/** Relative/absolute paths a write tool may have touched (incl. patch Add File). */
export function writeToolTargetPaths(
  toolName: string,
  args: unknown,
): readonly string[] {
  if (!WRITE_TOOL_NAMES.has(toolName)) return [];
  if (!args || typeof args !== "object") return [];
  const obj = args as Record<string, unknown>;
  if (toolName === "apply_patch") {
    const patch = typeof obj.patch === "string" ? obj.patch : "";
    if (!patch.trim()) return [];
    const out: string[] = [];
    for (const line of patch.split(/\r?\n/)) {
      const trimmed = line.trim();
      for (const marker of [
        "*** Add File: ",
        "*** Update File: ",
        "*** Delete File: ",
      ] as const) {
        if (!trimmed.startsWith(marker)) continue;
        const p = trimmed.slice(marker.length).trim();
        if (p) out.push(p);
        break;
      }
    }
    return out;
  }
  const p =
    (typeof obj.path === "string" && obj.path.trim()) ||
    (typeof obj.file_path === "string" && obj.file_path.trim()) ||
    "";
  return p ? [p] : [];
}

/**
 * Resolve write-tool paths against session cwd and sync AGENTS.md / pack
 * playbook.md mirrors. Returns how many fan-outs updated something.
 */
export function syncIdentityPlaybooksFromWriteTool(
  runtime: FaceRuntime,
  sessionId: string,
  toolName: string,
  args: unknown,
  resolveCwd: (sessionId: string) => string,
): number {
  const rels = writeToolTargetPaths(toolName, args);
  if (rels.length === 0) return 0;
  const cwd = resolveCwd(sessionId);
  let n = 0;
  for (const rel of rels) {
    const abs = path.isAbsolute(rel)
      ? path.resolve(rel)
      : path.resolve(cwd, rel);
    if (syncIdentityPlaybookAfterAgentsMdWrite(runtime, abs)) n += 1;
    else if (syncIdentityPlaybookAfterPackWrite(runtime, abs)) n += 1;
  }
  return n;
}

const SHELL_TOOL_NAMES = new Set(["bash", "shell", "exec_command"]);

/** Paths mentioned in a shell command that look like identity mirrors. */
export function shellIdentityTargetPaths(command: string): readonly string[] {
  if (!command.trim()) return [];
  const out: string[] = [];
  // Absolute or relative paths ending in AGENTS.md / playbook.md.
  const re =
    /(?:^|[\s"'`=])((?:[A-Za-z]:)?[^\s"'`;|&<>]*?(?:AGENTS\.md|playbook\.md))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const p = m[1]?.trim();
    if (p) out.push(p);
  }
  return out;
}

/**
 * After bash/shell: sync any AGENTS.md / playbook.md paths in the command,
 * and always re-adopt for agent-home identity seats (covers redirects / editors
 * that don't name the path plainly).
 */
export function syncIdentityPlaybooksFromShellTool(
  runtime: FaceRuntime,
  sessionId: string,
  toolName: string,
  args: unknown,
  resolveCwd: (sessionId: string) => string,
): number {
  if (!SHELL_TOOL_NAMES.has(toolName)) return 0;
  const obj =
    args && typeof args === "object"
      ? (args as Record<string, unknown>)
      : {};
  const command =
    (typeof obj.command === "string" && obj.command) ||
    (typeof obj.cmd === "string" && obj.cmd) ||
    (typeof obj.script === "string" && obj.script) ||
    "";
  const cwd = resolveCwd(sessionId);
  let n = 0;
  for (const rel of shellIdentityTargetPaths(command)) {
    const abs = path.isAbsolute(rel)
      ? path.resolve(rel)
      : path.resolve(cwd, rel);
    if (syncIdentityPlaybookAfterAgentsMdWrite(runtime, abs)) n += 1;
    else if (syncIdentityPlaybookAfterPackWrite(runtime, abs)) n += 1;
  }
  const memberId = runtime.sessionIdentities.get(sessionId)?.memberId?.trim();
  if (memberId && !isCatalogSeedMemberId(memberId)) {
    const listed = listedOf(runtime, memberId);
    if (listed) {
      const canvas =
        listed.scope === "global" ? GLOBAL_ROSTER_ID : listed.workspaceId!;
      const before = normalizeIdentityPlaybook(listed.playbook);
      const adopted = adoptLiveMemberIdentityPlaybook(runtime, canvas, listed);
      if (normalizeIdentityPlaybook(adopted.playbook) !== before) n += 1;
    }
  }
  return n;
}
