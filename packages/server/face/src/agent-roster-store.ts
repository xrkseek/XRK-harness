/**
 * Agent Team roster: the child's tools, inject, and playbook as named profiles.
 * Parent sessions already edit those surfaces via preset / `.xrk` / the user
 * message; a 干员 is the same three surfaces for `subagent`.
 * Global members live in `global.json`; workspace members overlay per canvas.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";
import {
  isAgentTeamSpawnRole,
  roleDeniedTools,
  type AgentTeamSpawnRole,
} from "./agent-team-roles.js";
import { tryWriteJsonSidecar } from "./json-sidecar.js";
import {
  GLASSES_BUILTINS,
  HAT_BUILTINS,
  HELD_BUILTINS,
  parseOverlayImage as parsePresenceOverlayImage,
  parseSlotPick,
  resolveEnginePick,
  resolveStickerOverlay,
  splitLegacyKit,
  stickerIdFromPick,
  type PresenceSticker,
} from "./presence-dressing.js";

export const MEMBER_NAME_MAX = 40;
export const MEMBER_NICKNAME_MAX = 24;
export const MEMBER_PLAYBOOK_MAX = 20_000;
export const MEMBER_FACE_MAX = 80_000;
export const MEMBER_BRIEF_MAX = 160;
export const GLOBAL_ROSTER_ID = "global";

export const MEMBER_SHAPES = [
  "blob",
  "wedge",
  "gem",
  "squircle",
  "drop",
  "pill",
  "petal",
  "loaf",
  "heart",
  "star",
  "hex",
  "egg",
  "cloud",
  "shield",
] as const;
export const MEMBER_COLORS = [
  "cream",
  "mist",
  "peach",
  "sage",
  "lilac",
  "slate",
  "coral",
  "butter",
  "mint",
  "sky",
  "rose",
  "cocoa",
  "honey",
  "ocean",
  "grape",
  "blush",
  "sand",
  "ink",
  "ice",
  "matcha",
] as const;
export const MEMBER_KITS = [
  "none",
  "bow",
  "cap",
  "beanie",
  "visor",
  "specs",
  "specs-rect",
  "specs-cat",
  "specs-sun",
  "halo",
] as const;

export type MemberShape = (typeof MEMBER_SHAPES)[number];
export type MemberColor = (typeof MEMBER_COLORS)[number];
export type MemberKit = (typeof MEMBER_KITS)[number];
export type RosterScope = "global" | "workspace";
export type MemberInject = "subagent" | "minimal";
/** Thin = index JSON only. Advanced = pack dir under `packs/{scope}/{id}/`. */
export type MemberKind = "thin" | "advanced";

export interface MemberAppearance {
  readonly shape: MemberShape;
  readonly color: MemberColor;
  /** Optional overlay kit (`none` omitted). PNG overlays are separate. */
  readonly kit?: Exclude<MemberKit, "none">;
  /** @deprecated Use `overlayHat`. Still read as the hat layer. */
  readonly face?: string;
  readonly overlayHat?: string;
  readonly overlayGlasses?: string;
  readonly overlayHeld?: string;
  /** Slot pick: builtin id or `sticker:<id>`. */
  readonly kitHat?: string;
  readonly kitGlasses?: string;
  readonly kitHeld?: string;
}

export interface MemberToolPolicy {
  readonly mode: "allow" | "deny";
  readonly names: readonly string[];
}

export interface AgentRosterMember {
  readonly id: string;
  readonly name: string;
  /** Optional short call-name; never on 向日葵. */
  readonly nickname?: string;
  readonly playbook: string;
  readonly role: AgentTeamSpawnRole;
  readonly appearance: MemberAppearance;
  readonly brief: string;
  readonly inject: MemberInject;
  readonly tools?: MemberToolPolicy;
  /** Thin (default) or advanced pack-backed member. */
  readonly kind: MemberKind;
  /**
   * Advanced packs start `false` after zip import until the parent marks ready.
   * Thin members are always ready.
   */
  readonly ready: boolean;
  /** True for catalog examples that ship with the file. */
  readonly seed?: true;
  readonly updatedAt: number;
}

export type ListedRosterMember = AgentRosterMember & {
  readonly scope: RosterScope;
  /** Catalog example id (`mem_seed_*`), even after the user edits and `seed` drops. */
  readonly catalog?: true;
  /** Owning project workspace when `scope === "workspace"`. */
  readonly workspaceId?: string;
};

/** Workspace office lead — costume editable; playbook stays catalog-owned. */
export const MANAGER_MEMBER_ID = "mem_seed_manager";

/** Xiangyang author seat — display 向日葵; nickname locked. */
export const SUNFLOWER_MEMBER_ID = "mem_seed_xrkseek";

const CATALOG_SEED_MEMBER_IDS = new Set([
  MANAGER_MEMBER_ID,
  SUNFLOWER_MEMBER_ID,
  "mem_seed_researcher",
  "mem_seed_worker",
  "mem_seed_reviewer",
  "mem_seed_lead",
  "mem_seed_scout",
  "mem_seed_docs",
  "mem_seed_fixer",
  "mem_seed_tester",
]);

export function isCatalogSeedMemberId(id: string): boolean {
  return CATALOG_SEED_MEMBER_IDS.has(id);
}

/** Only 经理 may patch catalog appearance; other seeds stay frozen. */
export function isCatalogAppearanceEditableId(id: string): boolean {
  return id === MANAGER_MEMBER_ID;
}

/** Nickname editable on catalog seeds except 向日葵 (custom members use upsert). */
export function isCatalogNicknameEditableId(id: string): boolean {
  return isCatalogSeedMemberId(id) && id !== SUNFLOWER_MEMBER_ID;
}

/** Formal + optional nickname for inject / catalog lines. */
export function displayMemberName(
  name: string,
  nickname: string | undefined,
): string {
  const formal = name.trim() || "?";
  const nick = nickname?.trim();
  if (!nick) return formal;
  return `${formal}（${nick}）`;
}

export function parseMemberNickname(
  raw: unknown,
  opts?: { readonly allow?: boolean },
): string | undefined {
  if (opts?.allow === false) return undefined;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, MEMBER_NICKNAME_MAX);
  return trimmed || undefined;
}

/** Built-in catalog ids cannot be updated or deleted; mint a new id to fork. */
export function catalogMemberWriteProblem(raw: unknown): string | undefined {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return undefined;
  const id = normalizeMemberId(trimmed);
  if (!id || !isCatalogSeedMemberId(id)) return undefined;
  return `catalog member ${id} is built-in; omit id to mint a new role from that template`;
}

/** Built-in catalog ids cannot be exported; mint a custom copy to share. */
export function catalogMemberExportProblem(raw: unknown): string | undefined {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return undefined;
  const id = normalizeMemberId(trimmed);
  if (!id || !isCatalogSeedMemberId(id)) return undefined;
  return `catalog member ${id} cannot be exported; mint a custom copy first`;
}

function listedMember(
  row: AgentRosterMember,
  scope: RosterScope,
  workspaceId?: string,
): ListedRosterMember {
  return {
    ...row,
    scope,
    ...(isCatalogSeedMemberId(row.id) ? { catalog: true as const } : {}),
    ...(scope === "workspace" && workspaceId ? { workspaceId } : {}),
  };
}

interface PersistShape {
  readonly version: 1;
  readonly members: AgentRosterMember[];
}

const ID_RE = /^mem_[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;

/**
 * `mem_`-prefixed id, or `undefined` when none was given (caller mints one).
 * A natural id (`xrk-releaseer`) gets the prefix rather than being dropped;
 * what still cannot match is the caller's bug — ask {@link memberIdProblem}
 * instead of silently handing back a different id.
 */
export function normalizeMemberId(raw: unknown): string | undefined {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return undefined;
  if (ID_RE.test(trimmed)) return trimmed;
  const prefixed = `mem_${trimmed}`;
  return ID_RE.test(prefixed) ? prefixed : undefined;
}

/** Non-empty when a supplied id can never be valid — surface it, don't blame name/playbook. */
export function memberIdProblem(raw: unknown): string | undefined {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed || normalizeMemberId(trimmed)) return undefined;
  return `invalid id "${trimmed}": expected mem_ then [A-Za-z0-9][A-Za-z0-9._-]* (max 64 chars); omit id to mint one`;
}

/** Default allow-list for a file-only 干员 (release / inspect). */
export const MEMBER_FILE_TOOLS = ["bash", "read", "grep", "glob"] as const;

/** `workspace` when omitted. Any other string is refused. */
export function parseRosterScope(raw: unknown): RosterScope | undefined {
  if (raw === undefined || raw === "workspace") return "workspace";
  if (raw === "global") return "global";
  return undefined;
}

export function rosterRoot(productHome?: string): string {
  return path.join(path.resolve(productHome ?? resolveXrkHome()), "agent-rosters");
}

/**
 * On-disk home for an advanced member pack (skills stay here — not workspace).
 * `rosterWorkspaceId` is `global` or the canvas workspace id.
 */
export function memberPackDir(
  rosterWorkspaceId: string,
  memberId: string,
  productHome?: string,
): string {
  const scopeKey =
    rosterWorkspaceId === GLOBAL_ROSTER_ID
      ? GLOBAL_ROSTER_ID
      : sanitizeWorkspaceId(rosterWorkspaceId);
  const id = normalizeMemberId(memberId) ?? memberId.trim();
  return path.join(rosterRoot(productHome), "packs", scopeKey, id);
}

/** Skills root inside an advanced pack (`…/skills`). */
export function memberPackSkillsDir(
  rosterWorkspaceId: string,
  memberId: string,
  productHome?: string,
): string {
  return path.join(memberPackDir(rosterWorkspaceId, memberId, productHome), "skills");
}

/**
 * Optional project tree inside an advanced pack (`…/workspace`).
 * When present, child default cwd prefers this over the pack root.
 */
export function memberPackWorkspaceDir(
  rosterWorkspaceId: string,
  memberId: string,
  productHome?: string,
): string {
  return path.join(memberPackDir(rosterWorkspaceId, memberId, productHome), "workspace");
}

function sanitizeWorkspaceId(workspaceId: string): string {
  const trimmed = workspaceId.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`invalid workspaceId: ${workspaceId}`);
  }
  return trimmed;
}

function filePath(workspaceId: string, productHome?: string): string {
  return path.join(rosterRoot(productHome), `${sanitizeWorkspaceId(workspaceId)}.json`);
}

function mintId(): string {
  return `mem_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function isMemberShape(value: unknown): value is MemberShape {
  return MEMBER_SHAPES.includes(value as MemberShape);
}

function isMemberColor(value: unknown): value is MemberColor {
  return MEMBER_COLORS.includes(value as MemberColor);
}

function isMemberKit(value: unknown): value is MemberKit {
  return MEMBER_KITS.includes(value as MemberKit);
}

/** Transparent PNG/JPEG/WebP/GIF/SVG data URL used as a kit overlay (hat / glasses / held). */
export function parseOverlayImage(raw: unknown): string | undefined {
  const parsed = parsePresenceOverlayImage(raw);
  if (parsed === undefined) return undefined;
  if (parsed.length > MEMBER_FACE_MAX) return undefined;
  return parsed;
}

function pickOverlay(
  base: Record<string, unknown>,
  key: string,
  fallback: string | undefined,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(base, key)) {
    return parseOverlayImage(base[key]);
  }
  return fallback;
}

export function parseMemberAppearance(
  raw: unknown,
  fallback: MemberAppearance,
): MemberAppearance {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const shape = isMemberShape(base.shape) ? base.shape : fallback.shape;
  const color = isMemberColor(base.color) ? base.color : fallback.color;
  const kitRaw = Object.prototype.hasOwnProperty.call(base, "kit")
    ? base.kit
    : fallback.kit;
  const kit = isMemberKit(kitRaw) && kitRaw !== "none" ? kitRaw : undefined;
  const overlayHat =
    pickOverlay(base, "overlayHat", fallback.overlayHat)
    ?? (Object.prototype.hasOwnProperty.call(base, "face")
      ? parseOverlayImage(base.face)
      : fallback.face);
  const overlayGlasses = pickOverlay(base, "overlayGlasses", fallback.overlayGlasses);
  const overlayHeld = pickOverlay(base, "overlayHeld", fallback.overlayHeld);
  const split = splitLegacyKit(kit);
  const kitHat = parseSlotPick(base.kitHat ?? fallback.kitHat, HAT_BUILTINS)
    ?? (split.hat !== "none" ? split.hat : undefined);
  const kitGlasses = parseSlotPick(base.kitGlasses ?? fallback.kitGlasses, GLASSES_BUILTINS)
    ?? (split.glasses !== "none" ? split.glasses : undefined);
  const kitHeld = parseSlotPick(base.kitHeld ?? fallback.kitHeld, HELD_BUILTINS);
  return {
    shape,
    color,
    ...(kit ? { kit } : {}),
    ...(kitHat && kitHat !== "none" ? { kitHat } : {}),
    ...(kitGlasses && kitGlasses !== "none" ? { kitGlasses } : {}),
    ...(kitHeld && kitHeld !== "none" ? { kitHeld } : {}),
    ...(overlayHat ? { overlayHat, face: overlayHat } : {}),
    ...(overlayGlasses ? { overlayGlasses } : {}),
    ...(overlayHeld ? { overlayHeld } : {}),
  };
}

export function appearanceLookWire(
  look: MemberAppearance,
  stickers: readonly PresenceSticker[] = [],
): {
  readonly shape: string;
  readonly color: string;
  readonly kit?: string;
  readonly kitHat?: string;
  readonly kitGlasses?: string;
  readonly kitHeld?: string;
  readonly overlayHat?: string;
  readonly overlayGlasses?: string;
  readonly overlayHeld?: string;
} {
  const split = splitLegacyKit(look.kit);
  const kitHat = look.kitHat ?? split.hat;
  const kitGlasses = look.kitGlasses ?? split.glasses;
  const kitHeld = look.kitHeld ?? "none";
  const hatOverlay = resolveStickerOverlay(kitHat, stickers)
    ?? (stickerIdFromPick(kitHat) ? undefined : look.overlayHat ?? look.face);
  const glassesOverlay = resolveStickerOverlay(kitGlasses, stickers)
    ?? (stickerIdFromPick(kitGlasses) ? undefined : look.overlayGlasses);
  const heldOverlay = resolveStickerOverlay(kitHeld, stickers)
    ?? (stickerIdFromPick(kitHeld) ? undefined : look.overlayHeld);
  const engineHat = resolveEnginePick(kitHat, HAT_BUILTINS);
  const engineGlasses = resolveEnginePick(kitGlasses, GLASSES_BUILTINS);
  const engineHeld = resolveEnginePick(kitHeld, HELD_BUILTINS);
  const kit = engineHat !== "none"
    ? engineHat
    : engineGlasses !== "none"
      ? engineGlasses
      : look.kit;
  return {
    shape: look.shape,
    color: look.color,
    ...(kit ? { kit } : {}),
    ...(engineHat !== "none" ? { kitHat: engineHat } : {}),
    ...(engineGlasses !== "none" ? { kitGlasses: engineGlasses } : {}),
    ...(engineHeld !== "none" ? { kitHeld: engineHeld } : {}),
    ...(hatOverlay ? { overlayHat: hatOverlay } : {}),
    ...(glassesOverlay ? { overlayGlasses: glassesOverlay } : {}),
    ...(heldOverlay ? { overlayHeld: heldOverlay } : {}),
  };
}

export function parseMemberToolPolicy(raw: unknown): MemberToolPolicy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const mode = o.mode === "allow" || o.mode === "deny" ? o.mode : undefined;
  if (!mode) return undefined;
  const names = Array.isArray(o.names)
    ? o.names.flatMap((n) => {
        const name = typeof n === "string" ? n.trim().toLowerCase() : "";
        return name && TOOL_NAME_RE.test(name) ? [name] : [];
      }).slice(0, 48)
    : [];
  if (names.length === 0) return undefined;
  return { mode, names };
}

export function parseMemberInject(raw: unknown, fallback: MemberInject): MemberInject {
  return raw === "subagent" || raw === "minimal" ? raw : fallback;
}

function briefOf(name: string, playbook: string, explicit?: string): string {
  const from = explicit?.trim() || playbook.split(/\n/)[0] || name;
  return clip(from, MEMBER_BRIEF_MAX);
}

/** True when `toolName` matches a deny entry (exact, or prefix when entry ends with `*`). */
export function toolNameDenied(
  toolName: string,
  denied: ReadonlySet<string>,
): boolean {
  const key = toolName.toLowerCase();
  if (denied.has(key)) return true;
  for (const pattern of denied) {
    if (pattern.endsWith("*") && key.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

/**
 * Parent-only tools a delegated child never keeps, even when it inherits the
 * parent's catalog or an allow-list names them. Nested children use the same
 * mask. `ask` stays (human questions walk to the human-facing ancestor).
 */
export const DELEGATED_INHERIT_DENY = [
  "ask_user",
  "team_save",
  "team_import",
  "team_ready",
  "team_export",
  "team_remove",
  "propose_skill",
  "exit_plan_mode",
  "settings_*",
  "workspace_*",
  "canvas_*",
] as const;

/** Strip {@link DELEGATED_INHERIT_DENY} from a live registry. Returns removed names. */
export function applyDelegatedInheritMask(tools: {
  list(): readonly { readonly name: string }[];
  unregister(name: string): boolean;
}): string[] {
  const denied = new Set(
    DELEGATED_INHERIT_DENY.map((name) => name.toLowerCase()),
  );
  const removed: string[] = [];
  for (const row of [...tools.list()]) {
    if (!toolNameDenied(row.name, denied)) continue;
    if (tools.unregister(row.name)) removed.push(row.name);
  }
  return removed;
}

/** Deny-only: a 干员 may weaken the parent preset, never add tools. */
export function applyRosterToolPolicy(
  tools: {
    list(): readonly { readonly name: string }[];
    unregister(name: string): boolean;
  },
  role: AgentTeamSpawnRole | undefined,
  policy?: MemberToolPolicy,
): void {
  const denied = new Set(
    roleDeniedTools(role).map((name) => name.toLowerCase()),
  );
  if (policy?.mode === "deny") {
    for (const name of policy.names) denied.add(name.toLowerCase());
  }
  if (policy?.mode === "allow") {
    const keep = new Set(policy.names.map((name) => name.toLowerCase()));
    for (const row of tools.list()) {
      const key = row.name.toLowerCase();
      if (!keep.has(key) || toolNameDenied(key, denied)) {
        tools.unregister(row.name);
      }
    }
    return;
  }
  for (const row of tools.list()) {
    if (toolNameDenied(row.name, denied)) tools.unregister(row.name);
  }
}

export function rosterPublicFields(row: ListedRosterMember) {
  return {
    id: row.id,
    name: row.name,
    ...(row.nickname ? { nickname: row.nickname } : {}),
    role: row.role,
    scope: row.scope,
    brief: row.brief,
    inject: row.inject,
    kind: row.kind,
    ready: row.ready,
    seed: row.seed === true,
    catalog: row.catalog === true,
    appearance: row.appearance,
    ...(row.tools ? { tools: row.tools } : {}),
  };
}

export function formatRosterCatalog(
  members: readonly ListedRosterMember[],
): string {
  if (members.length === 0) return "(no Agent Team members yet)";
  return members
    .map((row) => {
      const pub = rosterPublicFields(row);
      const tools =
        pub.tools?.mode === "allow"
          ? ` tools=${pub.tools.names.join(",")}`
          : pub.tools?.mode === "deny"
            ? ` deny=${pub.tools.names.join(",")}`
            : "";
      const ready =
        pub.ready
          ? ""
          : pub.kind === "advanced"
            ? " · not-ready → team_list(envPrep) → team_ready"
            : " · not-ready";
      const kind = pub.kind === "advanced" ? " · advanced" : "";
      const shown = displayMemberName(pub.name, pub.nickname);
      return `- ${pub.id} [${pub.scope}] ${shown} · ${pub.role} · inject=${pub.inject} · ${pub.brief}${tools}${kind}${ready}${pub.catalog ? " · catalog · no-export" : ""}`;
    })
    .join("\n")
    .slice(0, 2_400);
}

export function mergeGlobalSeedMembers(
  existing: readonly AgentRosterMember[],
  now = Date.now(),
): { readonly members: AgentRosterMember[]; readonly changed: boolean } {
  const catalog = seedGlobalRosterMembers(now);
  const leftover = new Map(existing.map((row) => [row.id, row]));
  const members: AgentRosterMember[] = [];
  for (const seed of catalog) {
    const prev = leftover.get(seed.id);
    leftover.delete(seed.id);
    // User-owned catalog fields: 经理 costume; nicknames on every seed but 向日葵.
    if (prev) {
      const keepAppearance = isCatalogAppearanceEditableId(seed.id);
      const keepNickname =
        isCatalogNicknameEditableId(seed.id) && Boolean(prev.nickname);
      if (keepAppearance || keepNickname) {
        members.push({
          ...seed,
          appearance: keepAppearance
            ? (prev.appearance ?? seed.appearance)
            : seed.appearance,
          ...(keepNickname ? { nickname: prev.nickname } : {}),
          updatedAt: Math.max(prev.updatedAt, seed.updatedAt),
        });
      } else {
        members.push(seed);
      }
    } else {
      members.push(seed);
    }
  }
  for (const rest of leftover.values()) {
    if (rest.seed === true) continue;
    members.push(rest);
  }
  return {
    members,
    changed: JSON.stringify(members) !== JSON.stringify(existing),
  };
}

/**
 * Operator-authority line for built-in catalog playbooks. Delegated children keep
 * product standing (`~/.xrk` AGENTS/SOUL) but skip home convention drafts; the
 * playbook is still the seat-specific operator text. Scope-bound by design: it
 * authorizes executing the assigned task, not escalating runtime permission.
 */
const CATALOG_AUTHORITY_LINE =
  "Scope task + this playbook are mandatory. Permission still binds. Deliver fully.";

export function seedGlobalRosterMembers(now = Date.now()): readonly AgentRosterMember[] {
  return [
    {
      id: MANAGER_MEMBER_ID,
      name: "经理",
      role: "lead",
      appearance: { shape: "squircle", color: "slate", kitHat: "visor" },
      seed: true,
      updatedAt: now,
      inject: "subagent",
      kind: "thin",
      ready: true,
      brief: "Workspace lead seat — takes top-seat dispatch and splits work.",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the mid-tier project seat (<seat_identity>). " +
        "Own the project session: clarify, break work, spawn via subagent member_id, report. " +
        "Coordinate over doing every edit. Multi-step → todo_write. Ask only when the deliverable changes — one blocker.",
    },
    {
      id: SUNFLOWER_MEMBER_ID,
      name: "向日葵",
      role: "lead",
      appearance: { shape: "petal", color: "butter", kitHat: "visor" },
      seed: true,
      updatedAt: now,
      inject: "subagent",
      kind: "thin",
      ready: true,
      brief: "Xiangyang author seat — takes top-seat dispatch, steers product and agents.",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are 向日葵 (xrkseek author seat on Xiangyang; nickname locked). " +
        "Dispatch coding peers; stay out of ws_default implementation. Multi-step → todo_write. " +
        "Ask only when the deliverable changes — one blocker.",
    },
    {
      id: "mem_seed_researcher",
      name: "调研员",
      role: "researcher",
      appearance: { shape: "blob", color: "mist" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      kind: "thin",
      ready: true,
      brief: "只读调研，引用路径与原文。",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the researcher. Read/search; cite paths. No durable edits unless tasked. " +
        "Multi-step → todo_write. Ask only on deliverable blockers.",
    },
    {
      id: "mem_seed_worker",
      name: "施工员",
      role: "worker",
      appearance: { shape: "wedge", color: "sage" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      kind: "thin",
      ready: true,
      brief: "按任务改代码，不扩范围。",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the implementer. Precise edits; stay in scope. Multi-step → todo_write. " +
        "Ask only on deliverable blockers.",
    },
    {
      id: "mem_seed_reviewer",
      name: "审稿员",
      role: "reviewer",
      appearance: { shape: "gem", color: "lilac" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      kind: "thin",
      ready: true,
      brief: "只读审稿，先报缺陷。",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the reviewer. Read-only unless asked to patch. Defects first. " +
        "Multi-step → todo_write. Ask only on deliverable blockers.",
    },
    {
      id: "mem_seed_lead",
      name: "调度员",
      role: "lead",
      appearance: { shape: "blob", color: "slate" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      kind: "thin",
      ready: true,
      brief: "拆任务、协调干员。",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the lead. Break work, coordinate, spawn specialists via member_id. " +
        "Multi-step → todo_write. Ask only on deliverable blockers.",
    },
    {
      id: "mem_seed_scout",
      name: "探网员",
      role: "researcher",
      appearance: { shape: "wedge", color: "peach" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      kind: "thin",
      ready: true,
      brief: "查网上公开事实，给出链接与日期。",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the web scout. Prefer web_search/web_fetch; cite URLs/dates; no repo edits. " +
        "Tool gaps go in FINAL. Multi-step → todo_write.",
    },
    {
      id: "mem_seed_docs",
      name: "文书员",
      role: "worker",
      appearance: { shape: "squircle", color: "butter" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      kind: "thin",
      ready: true,
      brief: "写诚实说明书与发行说明，不编未做能力。",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the docs writer. Follow docs/audiences.md; no invented APIs. Multi-step → todo_write.",
    },
    {
      id: "mem_seed_fixer",
      name: "排障员",
      role: "worker",
      appearance: { shape: "gem", color: "coral" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      kind: "thin",
      ready: true,
      brief: "复现故障、定位、修，并给出证据。",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the debugger. Reproduce → isolate → fix with evidence. Multi-step → todo_write.",
    },
    {
      id: "mem_seed_tester",
      name: "测员",
      role: "worker",
      appearance: { shape: "pill", color: "sage" },
      seed: true,
      updatedAt: now,
      inject: "minimal",
      kind: "thin",
      ready: true,
      brief: "跑相关测试，报告失败与最小复现。",
      playbook:
        CATALOG_AUTHORITY_LINE +
        " You are the tester. Run tests; report command + output. Multi-step → todo_write.",
    },
  ];
}

function parseMember(raw: unknown): AgentRosterMember | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID_RE.test(o.id)) return undefined;
  if (typeof o.name !== "string") return undefined;
  const name = clip(o.name, MEMBER_NAME_MAX);
  if (!name) return undefined;
  const playbook = typeof o.playbook === "string" ? clip(o.playbook, MEMBER_PLAYBOOK_MAX) : "";
  if (!playbook) return undefined;
  const role = isAgentTeamSpawnRole(o.role) ? o.role : "default";
  const updatedAt =
    typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
      ? o.updatedAt
      : 0;
  const appearance = parseMemberAppearance(o.appearance, {
    shape: "blob",
    color: "cream",
  });
  const tools = parseMemberToolPolicy(o.tools);
  const inject = parseMemberInject(o.inject, "minimal");
  const brief = briefOf(name, playbook, typeof o.brief === "string" ? o.brief : undefined);
  const kind: MemberKind = o.kind === "advanced" ? "advanced" : "thin";
  // Thin always ready; advanced requires explicit ready:true (import starts false).
  const ready = kind === "thin" ? true : o.ready === true;
  const nickname =
    o.id === SUNFLOWER_MEMBER_ID
      ? undefined
      : parseMemberNickname(o.nickname);
  return {
    id: o.id,
    name,
    playbook,
    role,
    appearance,
    brief,
    inject,
    kind,
    ready,
    updatedAt,
    ...(nickname ? { nickname } : {}),
    ...(tools ? { tools } : {}),
    ...(o.seed === true ? { seed: true as const } : {}),
  };
}

export class FaceAgentRosterStore {
  private readonly productHome: string | undefined;
  private readonly cache = new Map<string, PersistShape>();

  constructor(productHome?: string) {
    this.productHome = productHome;
  }

  /** Product home used for roster + pack paths (tests may override). */
  get home(): string | undefined {
    return this.productHome;
  }

  private emptyOrSeed(workspaceId: string): PersistShape {
    if (workspaceId === GLOBAL_ROSTER_ID) {
      return { version: 1, members: [...seedGlobalRosterMembers()] };
    }
    return { version: 1, members: [] };
  }

  private load(workspaceId: string): PersistShape {
    const cached = this.cache.get(workspaceId);
    if (cached) return cached;
    const file = filePath(workspaceId, this.productHome);
    if (!existsSync(file)) {
      const doc = this.emptyOrSeed(workspaceId);
      this.cache.set(workspaceId, doc);
      this.save(workspaceId, doc);
      return doc;
    }
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      const o = parsed && typeof parsed === "object" ? (parsed as PersistShape) : undefined;
      const members = Array.isArray(o?.members)
        ? o.members.flatMap((row) => {
            const member = parseMember(row);
            return member ? [member] : [];
          })
        : [];
      if (workspaceId === GLOBAL_ROSTER_ID) {
        const merged = mergeGlobalSeedMembers(members);
        const doc: PersistShape = { version: 1, members: merged.members };
        this.cache.set(workspaceId, doc);
        if (merged.changed) this.save(workspaceId, doc);
        return doc;
      }
      const kept = members.filter((row) => !isCatalogSeedMemberId(row.id));
      const doc: PersistShape = { version: 1, members: kept };
      this.cache.set(workspaceId, doc);
      if (kept.length !== members.length) this.save(workspaceId, doc);
      return doc;
    } catch {
      const doc = this.emptyOrSeed(workspaceId);
      this.cache.set(workspaceId, doc);
      return doc;
    }
  }

  private save(workspaceId: string, doc: PersistShape): void {
    this.cache.set(workspaceId, doc);
    const dir = rosterRoot(this.productHome);
    mkdirSync(dir, { recursive: true });
    tryWriteJsonSidecar(filePath(workspaceId, this.productHome), doc);
  }

  list(workspaceId: string): readonly AgentRosterMember[] {
    return this.load(workspaceId).members;
  }

  /** Global members first, then workspace; same id → workspace wins. */
  listVisible(workspaceId: string): readonly ListedRosterMember[] {
    const byId = new Map<string, ListedRosterMember>();
    for (const row of this.list(GLOBAL_ROSTER_ID)) {
      byId.set(row.id, listedMember(row, "global"));
    }
    if (workspaceId !== GLOBAL_ROSTER_ID) {
      for (const row of this.list(workspaceId)) {
        byId.set(row.id, listedMember(row, "workspace", workspaceId));
      }
    }
    return [...byId.values()];
  }

  /**
   * Team UI listing: globals + every workspace roster file.
   * Workspace rows keep their owning `workspaceId` so the panel can group by
   * project. Does not collapse same-id overlays across canvases.
   */
  listForTeamPanel(currentWorkspaceId: string): readonly ListedRosterMember[] {
    const out: ListedRosterMember[] = [];
    for (const row of this.list(GLOBAL_ROSTER_ID)) {
      out.push(listedMember(row, "global"));
    }
    const seen = new Set<string>();
    if (currentWorkspaceId && currentWorkspaceId !== GLOBAL_ROSTER_ID) {
      seen.add(currentWorkspaceId);
      for (const row of this.list(currentWorkspaceId)) {
        out.push(listedMember(row, "workspace", currentWorkspaceId));
      }
    }
    for (const wid of this.listWorkspaceRosterIds()) {
      if (seen.has(wid)) continue;
      for (const row of this.list(wid)) {
        out.push(listedMember(row, "workspace", wid));
      }
    }
    return out;
  }

  get(workspaceId: string, memberId: string): ListedRosterMember | undefined {
    const local = this.list(workspaceId).find((row) => row.id === memberId);
    if (local) {
      return listedMember(
        local,
        workspaceId === GLOBAL_ROSTER_ID ? "global" : "workspace",
        workspaceId === GLOBAL_ROSTER_ID ? undefined : workspaceId,
      );
    }
    const global = this.list(GLOBAL_ROSTER_ID).find((row) => row.id === memberId);
    return global ? listedMember(global, "global") : undefined;
  }

  /**
   * Locate a member id across global + every workspace roster file.
   * Used when the current canvas cannot see the id (workspace-scoped elsewhere).
   */
  findHome(
    memberId: string,
  ):
    | { readonly scope: "global"; readonly rosterWorkspaceId: typeof GLOBAL_ROSTER_ID }
    | { readonly scope: "workspace"; readonly rosterWorkspaceId: string }
    | undefined {
    const id = normalizeMemberId(memberId) ?? memberId.trim();
    if (!id) return undefined;
    if (this.list(GLOBAL_ROSTER_ID).some((row) => row.id === id)) {
      return { scope: "global", rosterWorkspaceId: GLOBAL_ROSTER_ID };
    }
    for (const wid of this.listWorkspaceRosterIds()) {
      if (this.list(wid).some((row) => row.id === id)) {
        return { scope: "workspace", rosterWorkspaceId: wid };
      }
    }
    return undefined;
  }

  upsert(
    workspaceId: string,
    input: {
      readonly id?: string;
      readonly name: string;
      readonly playbook: string;
      readonly role?: AgentTeamSpawnRole;
      readonly appearance?: Partial<MemberAppearance> | null;
      readonly brief?: string;
      readonly nickname?: string | null;
      readonly inject?: MemberInject;
      readonly tools?: MemberToolPolicy | null;
      readonly kind?: MemberKind;
      readonly ready?: boolean;
    },
  ): AgentRosterMember | undefined {
    const name = clip(input.name, MEMBER_NAME_MAX);
    const playbook = clip(input.playbook, MEMBER_PLAYBOOK_MAX);
    if (!name || !playbook) return undefined;
    const role = input.role ?? "default";
    const doc = this.load(workspaceId);
    const now = Date.now();
    const rawId = input.id?.trim() ?? "";
    const id = normalizeMemberId(rawId);
    const fallback: MemberAppearance = { shape: "blob", color: "cream" };
    const inject = parseMemberInject(input.inject, "minimal");
    const tools =
      input.tools === null ? undefined : parseMemberToolPolicy(input.tools);
    if (rawId && !id) return undefined; // illegal id — callers ask memberIdProblem() first
    if (id && isCatalogSeedMemberId(id)) return undefined;
    if (id) {
      const index = doc.members.findIndex((row) => row.id === id);
      const prev = index === -1 ? undefined : doc.members[index];
      const appearance = parseMemberAppearance(
        {
          ...(prev?.appearance ?? fallback),
          ...(input.appearance ?? {}),
        },
        prev?.appearance ?? fallback,
      );
      const nextTools =
        input.tools === undefined
          ? prev?.tools
          : tools;
      const kind: MemberKind =
        input.kind ?? prev?.kind ?? "thin";
      const ready =
        kind === "thin"
          ? true
          : input.ready !== undefined
            ? input.ready
            : (prev?.ready ?? false);
      const nickname =
        input.nickname === null
          ? undefined
          : input.nickname !== undefined
            ? parseMemberNickname(input.nickname)
            : prev?.nickname;
      const next: AgentRosterMember = {
        id,
        name,
        playbook,
        role,
        appearance,
        brief: briefOf(name, playbook, input.brief ?? prev?.brief),
        inject: input.inject !== undefined ? inject : (prev?.inject ?? "minimal"),
        kind,
        ready,
        updatedAt: now,
        ...(nickname ? { nickname } : {}),
        ...(nextTools ? { tools: nextTools } : {}),
      };
      const members =
        index === -1
          ? [...doc.members, next]
          : doc.members.map((row, i) => (i === index ? next : row));
      this.save(workspaceId, { version: 1, members });
      return next;
    }
    const kind: MemberKind = input.kind ?? "thin";
    const ready = kind === "thin" ? true : input.ready === true;
    const nickname = parseMemberNickname(input.nickname);
    const minted: AgentRosterMember = {
      id: mintId(),
      name,
      playbook,
      role,
      appearance: parseMemberAppearance(input.appearance ?? fallback, fallback),
      brief: briefOf(name, playbook, input.brief),
      inject,
      kind,
      ready,
      updatedAt: now,
      ...(nickname ? { nickname } : {}),
      ...(tools ? { tools } : {}),
    };
    this.save(workspaceId, { version: 1, members: [...doc.members, minted] });
    return minted;
  }

  /** Mark an advanced member ready (or not). Thin members stay ready. */
  setReady(
    workspaceId: string,
    memberId: string,
    ready: boolean,
  ): AgentRosterMember | undefined {
    const listed = this.get(workspaceId, memberId);
    if (!listed || listed.catalog) return undefined;
    const target =
      listed.scope === "global" ? GLOBAL_ROSTER_ID : workspaceId;
    if (listed.kind !== "advanced") {
      return listed;
    }
    return this.upsert(target, {
      id: listed.id,
      name: listed.name,
      playbook: listed.playbook,
      role: listed.role,
      brief: listed.brief,
      inject: listed.inject,
      kind: "advanced",
      ready,
      ...(listed.tools ? { tools: listed.tools } : {}),
      appearance: listed.appearance,
    });
  }

  /** Workspace roster file ids on disk (`global.json` is the other home). */
  private listWorkspaceRosterIds(): readonly string[] {
    const dir = rosterRoot(this.productHome);
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      if (!id || id === GLOBAL_ROSTER_ID) continue;
      try {
        sanitizeWorkspaceId(id);
      } catch {
        continue;
      }
      out.push(id);
    }
    return out;
  }

  /**
   * Patch costume for catalog members that allow it (经理). Playbook / name stay
   * seed-owned. Returns undefined when the id is not appearance-editable.
   */
  patchCatalogAppearance(
    memberId: string,
    appearance: Partial<MemberAppearance>,
  ): AgentRosterMember | undefined {
    return this.patchCatalogMeta(memberId, { appearance });
  }

  /**
   * Patch user-owned catalog fields (经理 costume; nicknames on all seeds but
   * 向日葵). Returns undefined when the id allows neither field.
   */
  patchCatalogMeta(
    memberId: string,
    patch: {
      readonly appearance?: Partial<MemberAppearance>;
      readonly nickname?: string | null;
    },
  ): AgentRosterMember | undefined {
    const id = normalizeMemberId(memberId);
    if (!id) return undefined;
    const canAppearance = isCatalogAppearanceEditableId(id);
    const canNickname = isCatalogNicknameEditableId(id);
    if (!canAppearance && !canNickname) return undefined;
    if (id === SUNFLOWER_MEMBER_ID && patch.nickname !== undefined) {
      return undefined;
    }
    const doc = this.load(GLOBAL_ROSTER_ID);
    const index = doc.members.findIndex((row) => row.id === id);
    if (index === -1) return undefined;
    const prev = doc.members[index]!;
    const nickname =
      !canNickname || patch.nickname === undefined
        ? prev.nickname
        : patch.nickname === null
          ? undefined
          : parseMemberNickname(patch.nickname);
    const next: AgentRosterMember = {
      ...prev,
      appearance:
        canAppearance && patch.appearance
          ? parseMemberAppearance(
              { ...prev.appearance, ...patch.appearance },
              prev.appearance,
            )
          : prev.appearance,
      updatedAt: Date.now(),
      seed: true,
      ...(nickname ? { nickname } : {}),
    };
    // Drop nickname key when cleared.
    const cleaned: AgentRosterMember = nickname
      ? next
      : (() => {
          const { nickname: _drop, ...rest } = next;
          return rest;
        })();
    const members = doc.members.map((row, i) => (i === index ? cleaned : row));
    this.save(GLOBAL_ROSTER_ID, { version: 1, members });
    return cleaned;
  }

  /**
   * Write into global.json or the canvas file.
   * Global scope is one home: drop that id from every workspace roster.
   * Workspace scope writes only that canvas (it may overlay a global row).
   */
  upsertAtScope(
    canvasWorkspaceId: string,
    scope: RosterScope,
    input: Parameters<FaceAgentRosterStore["upsert"]>[1],
  ): AgentRosterMember | undefined {
    const target = scope === "global" ? GLOBAL_ROSTER_ID : canvasWorkspaceId;
    const member = this.upsert(target, input);
    if (member && scope === "global") {
      for (const workspaceId of this.listWorkspaceRosterIds()) {
        this.remove(workspaceId, member.id);
      }
    }
    return member;
  }

  remove(workspaceId: string, memberId: string): boolean {
    if (isCatalogSeedMemberId(memberId)) return false;
    const doc = this.load(workspaceId);
    const members = doc.members.filter((row) => row.id !== memberId);
    if (members.length === doc.members.length) return false;
    this.save(workspaceId, { version: 1, members });
    return true;
  }
}
